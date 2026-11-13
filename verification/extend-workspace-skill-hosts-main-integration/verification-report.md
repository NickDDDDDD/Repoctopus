# Workspace 宿主扩展与 Windows 安装修复集成验收

Tested implementation commit: `f8ac9c30e473e342b5c8b13f3d351079d9c485b4`
Package content SHA-256: `dc9d14f607ffb92ce8efc93cd13309593c0f24076f0ef79bb88cef3400df1f48`
Package files: `481`
Package content bytes: `6271221`
Archive SHA-256: `bd46a51a2879f1ca10aa6a00d41b9070bb16046fe38838c232cb14298a258d65`

基于同一提交锁定的依赖重新安装并构建，Windows 上的 `npm run test:package-e2e` 通过。测试从实际 tgz 安装生产依赖，核对 Cordis 安装形态和版本，使用安装后的 CLI 执行项目接入、Skill 安装和公开工作流命令。

三种 IDE 的原生装填与 Run 恢复记录来自宿主扩展的原候选包。合入当前 main 后的集成候选在本次重新执行安装包回归，当前提交的完整检查由 PR CI 执行。

[原候选包及 IDE 验收](../extend-workspace-skill-hosts/verification-report.md)
