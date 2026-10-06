/**
 * How many slabs were finished by a set of completed processing sessions.
 *
 * Grinding, resin and polishing are separate sessions over the same slabs, so a slab
 * finished in a day usually appears two or three times. Adding the lines up reported
 * 330 polished for 110 slabs.
 *
 * - An identified piece counts once, however many stages it went through.
 * - A lot line carries a count, not identities, so the pieces cannot be told apart
 *   across stages. Only the POLISHING stage is counted: it is the one that makes
 *   stock sellable, and a slab is polished once.
 *
 * Shared by the DPR and the daily report so the two can never disagree again. Lines
 * may carry bare ids (DPR) or the related rows (daily report); either is read.
 */
type ProcessLine = {
  slabId?: string | null;
  slab?: { id: string } | null;
  rawBlockId?: string | null;
  rawBlock?: unknown;
  slabCount: number | null;
};

export function finishedPieceCount(
  sessions: ReadonlyArray<{ processType: string; slabs: ReadonlyArray<ProcessLine> }>,
): number {
  const pieces = new Set<string>();
  let lotSlabs = 0;
  for (const session of sessions) {
    for (const line of session.slabs) {
      const pieceId = line.slabId ?? line.slab?.id;
      if (pieceId) pieces.add(pieceId);
      else if (session.processType === "POLISHING" && (line.rawBlockId || line.rawBlock) && line.slabCount) {
        lotSlabs += line.slabCount;
      }
    }
  }
  return pieces.size + lotSlabs;
}
