package com.lg

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import cn.jpush.android.api.JPushInterface

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private val REQUEST_CODE_POST_NOTIFICATIONS = 101

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 1. 请求安卓 13+ 的通知权限
        requestNotificationPermission()

        // 2. 初始化并配置 WebView
        webView = WebView(this).apply {
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                    view.loadUrl(url)
                    return true
                }
            }
            // 注入 JS 桥梁让网页获取极光 Registration ID
            addJavascriptInterface(JSBridge(), "AndroidBridge")
        }

        setContentView(webView)
        
        // 加载打包部署后的网页端线上地址
        webView.loadUrl("https://longgaobei.pages.dev")
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    REQUEST_CODE_POST_NOTIFICATIONS
                )
            }
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    // 内部类作为 JavaScript 交互桥梁
    inner class JSBridge {
        @JavascriptInterface
        fun getRegistrationId(): String {
            return JPushInterface.getRegistrationID(this@MainActivity) ?: ""
        }
    }
}
