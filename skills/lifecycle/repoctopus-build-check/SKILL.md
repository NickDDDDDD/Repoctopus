---
name: repoctopus-build-check
description: Check package completion, acceptance, tests, repository stability, and independent standard review.
disable-model-invocation: false
user-invocable: false
metadata:
  repoctopus:
    role: action
    phase: build
    action: check
---

# Check managed Build

Assess the current configuration and Plan revision. Require all required package Outcomes, Task acceptance evidence, relevant tests, stable repository bindings, no unresolved blocking finding, and a standard review whose managed reviewer execution differs from the implementation execution. Return structured Check evidence and bounded findings. Do not select Verify or create a Repair lifecycle; Runtime alone decides the next Action or Plan revision.

For implementation repair, review the ensemble of original retained and new completions, including the failed machine evidence and current inputs. Do not claim that retained completions were executed by the repair invocation. Runtime revalidates their machine proofs before accepting Check and creating fresh Verify evidence.
