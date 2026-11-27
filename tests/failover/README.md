# 主备线路回归

在仓库根目录运行（Node.js）：

```sh
node tests/failover/build-tests.mjs
node tests/failover/build-endpoint-tests.mjs
node tests/failover/bundle.cjs
node tests/failover/endpoints.cjs
node tests/failover/test-91porn.mjs
node tests/failover/test-long-pages.mjs
```

QuickJS 复验：

```sh
qjs -m tests/failover/bundle-qjs.js
qjs -m tests/failover/endpoints-qjs.js
```

测试通过 mock 宿主 HTTP 向真实插件代码注入故障，不联网，不证明生产域名当前可用。覆盖主站失效、备用健康、清单/密钥/首片失败、取消和登录错误不重试、分页404、200验证页、动态缓存镜像和长页头。

`HGHUB_PLUGIN_DIR` 可覆盖插件目录。`test-long-pages.mjs` 可额外设置 `LIVE_HTML_DIR`，从中读取 `failover-mrds-home.html` 和 `failover-bl911-home.html` 实际页面夹具。

生成的 bundle 是临时文件，不提交。
