package com.lg

import android.app.Application
import cn.jpush.android.api.JPushInterface

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        
        // 初始化极光推送 SDK
        JPushInterface.setDebugMode(true) // 测试阶段开启 Debug
        JPushInterface.init(this)
    }
}
