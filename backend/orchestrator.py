import asyncio
from llm import ask
from prompts import PLANNER, EXECUTOR, ROUTER
from schemas import Plan, Scene, Intent


async def make_plan(topic: str, level: str) -> Plan:
    data = await ask(PLANNER.format(level=level), topic, Plan.model_json_schema())
    return Plan(**data)


async def make_scene(topic: str, goal: str, level: str, shown: list) -> Scene:
    data = await ask(
        EXECUTOR.format(topic=topic, goal=goal, level=level, shown=shown[-3:]),
        "Write the scene.",
        Scene.model_json_schema(),
    )
    return Scene(**data)


class Session:
    def __init__(self, ws):
        self.ws = ws
        self.level = "beginner"
        self.topic = ""
        self.shown = []
        self.resume = asyncio.Event()
        self.resume.set()
        self._done = None
        self.task = None

    async def emit(self, **msg):
        await self.ws.send_json(msg)

    async def emit_scene_and_wait(self, **message):
        self._done = asyncio.get_running_loop().create_future()
        await self.emit(type="scene", **message)
        await self._done

    async def teach(self, topic: str):
        try:
            self.topic = topic
            self.shown = []
            await self.emit(type="status", state="planning")
            plan = await make_plan(topic, self.level)

            for i, goal in enumerate(plan.scenes):
                await self.resume.wait()
                await self.emit(type="status", state="writing", scene=i)
                scene = await make_scene(topic, goal, self.level, self.shown)
                # An interruption can arrive while the scene is being generated.
                # Hold it until the interruption response has finished.
                await self.resume.wait()
                self.shown.append(scene.title)
                await self.emit_scene_and_wait(
                    index=i,
                    total=len(plan.scenes),
                    scene=scene.model_dump(),
                )
            await self.emit(type="done")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            await self.emit(type="error", message=str(e))

    async def interrupt(self, text: str):
        if not self.topic:
            await self.emit(type="error", message="Start a lesson before asking a question.")
            return

        self.resume.clear()
        # Release the current scene if the learner interrupted its narration.
        if self._done and not self._done.done():
            self._done.set_result(True)
        await self.emit(type="pause")
        try:
            data = await ask(ROUTER.format(topic=self.topic), text, Intent.model_json_schema())
            it = Intent(**data)

            if it.intent == "stop":
                if self.task:
                    self.task.cancel()
                self.resume.set()
                await self.emit(type="done")
                return
            if it.intent == "new_topic":
                if self.task:
                    self.task.cancel()
                self.resume.set()
                self.task = asyncio.create_task(self.teach(it.argument or text))
                return

            if it.intent == "simplify":
                self.level = "beginner"
            goals = {
                "question": f"Answer the learner's question: {it.argument or text}",
                "repeat": "Explain the previous scene again in a different way",
                "simplify": "Explain the previous scene in much simpler words",
            }
            scene = await make_scene(self.topic, goals[it.intent], self.level, self.shown)
            await self.emit_scene_and_wait(
                index=-1,
                total=0,
                scene=scene.model_dump(),
                aside=True,
            )
            self.resume.set()
            await self.emit(type="resume")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            self.resume.set()
            await self.emit(type="error", message=str(e))
