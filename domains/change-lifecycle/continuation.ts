import type { ChangeLifecycleSnapshot, ChangeNextAction } from './transition.js';

export function projectLifecycleNextActions(
  snapshot: ChangeLifecycleSnapshot,
): readonly ChangeNextAction[] {
  if (['completed', 'failed', 'migration_required'].includes(snapshot.status)) return [];
  if (snapshot.phase === 'open') {
    if (snapshot.currentWork) {
      return [
        {
          id: snapshot.currentWork.workId,
          kind: 'work',
          label: `Run ${snapshot.currentWork.kind}`,
        },
      ];
    }
    return snapshot.status === 'waiting'
      ? [{ id: 'open.review', kind: 'decision', label: 'Review Open baseline' }]
      : [];
  }
  if (snapshot.phase === 'design') {
    if (snapshot.status === 'waiting') {
      return [{ id: 'design.review', kind: 'decision', label: 'Review planning decision' }];
    }
    if (snapshot.status === 'blocked') {
      return [{ id: 'design.repair', kind: 'repair', label: 'Repair planning artifacts' }];
    }
    return [{ id: 'design.evaluate', kind: 'work', label: 'Evaluate Design gate' }];
  }
  if (snapshot.phase === 'build') {
    if (snapshot.currentWork) {
      return [
        {
          id: snapshot.currentWork.workId,
          kind: 'work',
          label: `Run ${snapshot.currentWork.kind}`,
        },
      ];
    }
    if (snapshot.status === 'waiting') {
      return [{ id: 'build.review', kind: 'decision', label: 'Review Build decision' }];
    }
    if (snapshot.status === 'blocked') {
      return [{ id: 'build.blocked', kind: 'wait', label: 'Resolve Build blocker' }];
    }
    return [
      {
        id: 'build.prepare-verification',
        kind: 'work',
        label: 'Prepare immutable verification input',
      },
    ];
  }
  if (snapshot.phase === 'verify' && snapshot.currentWork?.kind === 'evidence.verify') {
    return [
      {
        id: snapshot.currentWork.workId,
        kind: 'work',
        label: 'Run the required Evidence profile',
      },
    ];
  }
  if (snapshot.phase === 'archive' && snapshot.currentWork?.kind === 'specification.close') {
    return [
      {
        id: snapshot.currentWork.workId,
        kind: 'work',
        label: 'Close the verified Specification change',
      },
    ];
  }
  if (snapshot.phase === 'archive' && snapshot.currentWork?.kind === 'delivery.publish') {
    return [
      {
        id: snapshot.currentWork.workId,
        kind: 'work',
        label: 'Publish all merge requests and accept the Publication Receipt',
      },
    ];
  }
  if (snapshot.phase === 'archive' && snapshot.currentWork === null) {
    return [{ id: 'archive.prepare', kind: 'work', label: 'Prepare Archive Delivery input' }];
  }
  return [];
}
