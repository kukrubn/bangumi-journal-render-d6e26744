# 番剧手账安卓版

用安卓手机浏览器[下载安装包](https://bangumi-journal.onrender.com/downloads/bangumi-journal-android.apk)，打开文件后点「安装」。支持 Android 8.0 及以上，需要能访问片单站点的网络和新版 Android 系统 WebView。已有账号使用原登录名和密码，新用户通过管理员发来的一次性邀请注册。

应用使用系统 WebView 连接现有云端服务。播放链接交给系统浏览器，JSON 恢复和备份导出使用系统文件选择器。安装包与邀请链接可分开发送。网站的公开关联文件位于 `public/.well-known/assetlinks.json`。

## 本地构建

准备 JDK 17、Android SDK Platform 36 和 Build Tools 36，在此目录执行：

```powershell
.\gradlew.bat :app:assembleDebug
```

调试 APK 输出到 `app/build/outputs/apk/debug/`。正式版使用环境变量 `JOURNAL_ANDROID_KEYSTORE` 指定 PKCS12 密钥库的绝对路径，`JOURNAL_ANDROID_SIGNING_PASSWORD` 指定库和密钥密码，别名为 `journal-release`。配置后运行 `.\gradlew.bat :app:assembleRelease`，使用 SDK 的 `apksigner verify --verbose --print-certs` 验签，把正式 APK 放到 `public/downloads/bangumi-journal-android.apk`。下一版本递增 `versionCode` 并沿用相同密钥，已安装用户即可覆盖升级。

自行部署其他站点时，同时修改 MainActivity 的域名和 AndroidManifest 中的邀请域名，再把自己的签名证书 SHA-256 登记到该站点的 `/.well-known/assetlinks.json`。
