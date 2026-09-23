---
name: TradeFlow Lite homepage prototype
description: 用户指定 Linear 参考的黑白首页
colors:
  background: "#090909"
  foreground: "#f2f2f2"
  secondary: "#999999"
  panel: "#0d0d0d"
  button: "#151515"
  primary: "#ededed"
  primary-ink: "#111111"
typography:
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "clamp(44px,5vw,66px)"
    fontWeight: 570
    lineHeight: 1.17
    letterSpacing: "-0.035em"
  section:
    fontSize: "44px"
    fontWeight: 550
    lineHeight: 1.22
    letterSpacing: "-0.035em"
rounded:
  button: "7px"
  module: "12px"
spacing:
  gutter: "28px"
  mobile-gutter: "22px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.button}"
    padding: "12px 18px"
  button-secondary:
    backgroundColor: "{colors.button}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.button}"
    padding: "12px 18px"
---

# Design System: TradeFlow Lite homepage prototype

## Overview

**Creative North Star: "Linear 黑白参考"**

用户指定 Linear 参考的黑白视觉方向：近黑底色、左对齐标题、宽幅真实产品截图与细线模块结构。此文档仅约束 Lite 本地首页原型，覆盖 Lite 主页面及四个详情页，不覆盖应用界面或生产网站。

**Key Characteristics:**

- 近黑底色与灰白文字。
- 左对齐标题和宽幅截图。
- 细线模块与充足留白。

## Colors

页面使用中性色。真实图表与 AI 工作台截图保留原色；截图边缘通过透明渐隐融入页面。主要操作采用浅色底与深色字，次要操作沿用深色表面。

## Typography

采用代码现有的平台与中文字体栈。首屏标题上限见 display token；段落在 14–17px 范围，辅助标签在 10–13px 范围。小屏通过媒体查询缩小标题与说明文字。

## Layout

内容容器最大宽度 1136px，桌面与手机边距见 spacing。900px 与 600px 是现有响应断点。首屏文案左对齐；能力区桌面为左右两栏，手机为上下两层。对比内容在手机转为单列。

## Elevation & Depth

页面主要用边界线与明度区分区域。首屏真实截图采用轻透视和向底色渐隐，阴影为 `0 40px 80px #0008`；中心核心节点阴影为 `0 25px 40px #0008`。截图入场动画为 1.3s，模块线条信号为 8s；减少动态效果偏好下关闭动画和过渡。

## Shapes

按钮采用轻圆角，结构模块采用中等圆角。模块连线为一像素细线；图表画面保留矩形应用窗口形态。

## Components

主按钮悬停变白并上移 1px；次按钮悬停表面变亮。链接与按钮均有 2px 浅色键盘焦点框。能力标签通过文字明度和底部细线区分选中状态，支持点击、左右箭头、Home 与 End。真实截图有描述性替代文字，首屏截图可点击放大。模块图明确标记为示意。

## Do's and Don'ts

- 保留真实截图的原始颜色。
- 用标题、间距与细线表达层级。
- 保持概览、指标、数据、AI 与扩展、开始使用五个入口与三个能力标签可用。
- 不要引入品牌彩色装饰。
- 不要把示意结构当作产品截图。
- 不要将原型文档作为生产部署依据。

## Page hierarchy

主导航为概览、指标、数据、AI 与扩展，右侧为开始使用。基础设施与产品对比作为主页锚点；旧 foundation、compare 和 extensions 路径仅作跳转。官方维护范围在主页完整说明，详情页只保留相关一句话。
