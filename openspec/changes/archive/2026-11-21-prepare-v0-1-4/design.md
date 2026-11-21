# 设计

固定 Design Action 只引用当前 Work 的 `design-method` 方法层。Runtime 继续解析默认实现与团队替换，Host 根据实际收到的正文及资源工作。发布版本由 `package.json` 和锁文件共同确定，安装示例使用与候选一致的固定版本。

验收通过安装包的公开 CLI 核对默认预览，以及团队替换从预览到实际 Design packet 和规则应用的完整路径。发布 Prepare 继续从通过 CI 的 main 提交构建并封存 CLI、Windows 安装器和校验文件。人工批准公开后，Publish 才会使用该批资产。
