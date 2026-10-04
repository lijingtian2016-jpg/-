import { sendDailyLoveLetterToAll } from '@/lib/email'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  // 第一步：验证请求是否合法
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json(
      { error: '未授权访问' },
      { status: 401 }
    )
  }

  // 第二步：执行任务——给所有用户发情话邮件
  try {
    await sendDailyLoveLetterToAll()
    return NextResponse.json({
      success: true,
      message: '每日情话发送完成',
      time: new Date().toISOString(),
    })
  } catch (error) {
    console.error('每日情话发送失败：', error)
    return NextResponse.json(
      { error: '发送失败' },
      { status: 500 }
    )
  }
}
