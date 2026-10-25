---
name: repoctopus-archive-change
description: Close the Specification side of an approved Change using the Provider-owned archive protocol.
disable-model-invocation: false
user-invocable: false
metadata:
  repoctopus:
    role: action
    phase: archive
---

# Archive a managed Change

Execute only the selected `specification.close` Work. Reconcile the closure candidate with the accepted specification and Provider protocol, then perform only authorized Specification mutations.

Do not create or merge a business MR, wait for remote merge, or declare the Run completed. Return an Outcome; closure validation and the separate `delivery.publish` Work remain Runtime-owned.
