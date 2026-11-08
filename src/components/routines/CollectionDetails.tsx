import { useState } from "react";
import type { Routine, RoutineRun } from "@/lib/routines";
import { useStore } from "@/state/store";
import { EventDetails } from "../RoutineCalendarPage";

export function CollectionDetails({ routine, onClose, onEdit }: { routine: Routine; onClose: () => void; onEdit: () => void }) {
  const { state } = useStore();
  const [runId, setRunId] = useState<string | null>(null);
  const run = state.routineRuns.find(candidate => candidate.id === runId && candidate.routineId === routine.id)
    ?? state.routineRuns.filter(candidate => candidate.routineId === routine.id).sort((a, b) => b.createdAt - a.createdAt)[0];
  const openRun = (selected: RoutineRun) => setRunId(selected.id);
  return <EventDetails key={runId ?? routine.id} item={{ kind: "routine", id: run?.id ?? routine.id, routine, run: run ?? null, at: run?.scheduledFor ?? routine.createdAt, durationMinutes: 30 }} bots={state.bots} onClose={onClose} onEdit={onEdit} onCallChanged={() => {}} onOpenRoom={() => {}} onOpenRun={openRun} />;
}
