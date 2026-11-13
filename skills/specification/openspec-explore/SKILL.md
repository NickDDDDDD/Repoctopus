---
name: openspec-explore
description: Inspect the current Repoctopus Workspace's OpenSpec requirements and discuss a possible change without writing artifacts.
disable-model-invocation: true
metadata:
  repoctopus:
    adapted-from: '@fission-ai/openspec@1.14.3 explore workflow'
---

# Explore OpenSpec requirements

Use this skill to investigate and discuss requirements. Read the Workspace's OpenSpec configuration, existing specs, relevant Change artifacts, and the code that implements them. For a linked repository, use the Workspace's configured Store. Surface the constraints, open questions, and evidence you found.

Keep exploration read-only. To start or change a Repoctopus-managed Change, invoke the Workspace's repoctopus entry Skill and use the current Runtime Action and Specification Provider instructions.
