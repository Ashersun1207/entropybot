import { createRoot } from "react-dom/client";
import { StoreProvider, initialState } from "../../src/state/store";
import { EventDetails } from "../../src/components/RoutineCalendarPage";
import "../../src/styles.css";

const [bots, routines] = await Promise.all([
  fetch("/api/bots").then((response) => response.json()),
  fetch("/api/routines").then((response) => response.json()),
]);
initialState.bots = bots.bots;
initialState.routines = routines.routines;
const selected = new URL(location.href).searchParams.get("routine");
const routine = routines.routines.find((candidate: { id: string }) => candidate.id === selected) ?? routines.routines[0];
createRoot(document.getElementById("root")!).render(
  <StoreProvider>
    <EventDetails item={{ kind: "routine", id: "synthetic", at: Date.now(), durationMinutes: 30, routine, run: null }}
      bots={bots.bots} onClose={() => {}} onEdit={() => {}} onCallChanged={() => {}} onOpenRoom={() => {}} />
  </StoreProvider>,
);
