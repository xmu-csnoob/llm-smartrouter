"""Routing benchmark dataset with 200 labeled cases."""

from __future__ import annotations

from typing import Any


def _case(
    case_id: str,
    round_name: str,
    expected_tier: str,
    prompt: str,
    *,
    max_tokens: int = 256,
    tools: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    request: dict[str, Any] = {
        "model": "auto",
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }
    if tools:
        request["tools"] = tools
    return {
        "id": case_id,
        "round": round_name,
        "expected_tier": expected_tier,
        "request": request,
    }


def build_benchmark_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []

    short_prompts = [
        "HTTP 200 是啥",
        "TCP 是什么",
        "JSON 有啥用",
        "Docker 是啥",
        "Git rebase 是啥",
        "Python list 是啥",
        "JWT 是什么",
        "Redis 有啥用",
        "SQL join 是啥",
        "REST 是什么",
    ]
    short_suffixes = [
        "一句话解释",
        "简要说明",
        "快速定义",
        "简单介绍",
        "通俗解释",
    ]
    for suffix_idx, suffix in enumerate(short_suffixes, start=1):
        for prompt_idx, base in enumerate(short_prompts, start=1):
            cases.append(
                _case(
                    f"r1-{suffix_idx:02d}-{prompt_idx:02d}",
                    "round1_simple",
                    "tier3",
                    f"{base}，{suffix}",
                    max_tokens=64,
                )
            )

    tier2_actions = [
        "整理接口分页方案并补充验收要点",
        "写一版 README 目录和使用说明",
        "补一份发布流程说明和回滚步骤",
        "梳理日志字段并给出表格化说明",
        "产出一次迁移清单和风险提示",
        "给控制台页面写信息架构草案",
        "写一份接入文档和示例请求",
        "整理监控指标口径和告警建议",
        "给批处理任务补运行手册",
        "写一版 API 变更公告模板",
    ]
    tier2_domains = [
        "支付服务",
        "消息中心",
        "路由代理",
        "用户系统",
        "订单后台",
    ]
    for domain_idx, domain in enumerate(tier2_domains, start=1):
        for action_idx, action in enumerate(tier2_actions, start=1):
            cases.append(
                _case(
                    f"r2-{domain_idx:02d}-{action_idx:02d}",
                    "round2_workhorse",
                    "tier2",
                    f"请针对{domain}{action}，要求结构清楚、可直接发给团队执行。",
                    max_tokens=384,
                )
            )

    tier1_paths = [
        "/srv/api/router.py",
        "/srv/worker/sync_jobs.py",
        "/srv/billing/settlement.py",
        "/srv/webhooks/handler.py",
        "/srv/auth/session_store.py",
    ]
    tier1_errors = [
        "Traceback: ValueError at line 128",
        "Traceback: KeyError at line 67",
        "Exception: timeout while reading upstream",
        "stack trace shows retry loop exploding",
        "warning: deadlock suspected in background worker",
    ]
    tier1_snippets = [
        "```python\nresult = cache[key]\n```",
        "```python\nasyncio.gather(*tasks)\n```",
        "```python\nsession.commit()\n```",
        "```python\npayload = json.loads(body)\n```",
        "```python\nfor item in queue:\n    process(item)\n```",
    ]
    tier1_goals = [
        "请分析根因并给出安全修复方案。",
        "请定位问题链路并给出最小改动修复。",
        "请解释为什么会发生并补充回归测试思路。",
        "请给出排障步骤、修复方案和验证方法。",
        "请结合可能竞态点说明风险与修复路径。",
    ]
    for idx, (path, error, snippet, goal) in enumerate(
        zip(tier1_paths * 10, tier1_errors * 10, tier1_snippets * 10, tier1_goals * 10),
        start=1,
    ):
        cases.append(
            _case(
                f"r3-{idx:03d}",
                "round3_frontier",
                "tier1",
                f"线上服务报错，文件路径 {path}。{error}\n{snippet}\n{goal}",
                max_tokens=768,
            )
        )

    boundary_tier2 = [
        "帮我整理一版灰度发布清单和回滚条件，便于值班同学执行。",
        "请把最近一周的接口改动整理成对外公告草稿，突出兼容性影响。",
        "为管理后台补一版筛选器设计说明，列出字段、交互和验收点。",
        "请总结一次数据库迁移的前置检查项、执行步骤和回退方案。",
        "给 SDK 接入写一份常见问题文档，覆盖鉴权、超时和重试。",
        "为日志平台写一个字段命名规范说明，方便团队统一口径。",
        "请给运维团队整理一版容量评审模板和填写示例。",
        "把现有 API 列表重组为导航结构，输出建议的信息架构。",
        "请梳理用户导出功能的交互流程，并补充边界场景说明。",
        "给批量任务平台写一版使用手册，覆盖创建、暂停和重跑。",
        "请形成一次监控接入方案，列出指标、阈值和告警对象。",
        "为 webhook 接入整理一份对接说明，带签名校验示例。",
        "请把代码所有者规则写成团队可执行的维护流程说明。",
        "补一版版本发布 Checklist，覆盖测试、备份和回滚通知。",
        "为多租户控制台写一版权限模型说明和运营约束。",
        "请总结最近故障复盘模板，突出时间线和行动项结构。",
        "整理缓存预热方案，说明执行时机、监控项和失败处理。",
        "把定时报表流程整理成运维 Runbook，便于交接使用。",
        "为审计日志设计展示字段，补一版查询交互说明。",
        "给内部平台整理一版接入申请流程和审批标准。",
    ]
    for idx, prompt in enumerate(boundary_tier2, start=1):
        cases.append(
            _case(
                f"r4-t2-{idx:02d}",
                "round4_boundary",
                "tier2",
                prompt,
                max_tokens=384,
            )
        )

    boundary_tier1 = [
        "文件 /srv/router/fallback.py 出现 Traceback: RuntimeError at line 88，请分析根因并给出修复步骤。",
        "下面这段代码导致队列阻塞：```python\nawait lock.acquire()\nawait queue.get()\n``` 请定位风险并说明修复。",
        "日志显示 /srv/jobs/retry.py 出现 stack trace 且重复重试失控，请给出排障与修复方案。",
        "线上 /srv/batch/exporter.py 报 Exception: timeout while writing file，附代码 ```python\nwriter.flush()\n```，请分析原因。",
        "文件 /srv/auth/token_cache.py 触发 KeyError 并伴随缓存击穿，请解释问题链路和修复方法。",
        "下面的 webhook 处理器反复报 warning: deadlock suspected，代码 ```python\nasync with lock:\n    await sync_all()\n```，请分析。",
        "路径 /srv/gateway/upstream.py 出现 Traceback: ValueError at line 143，请结合这段代码 ```python\npayload = body.decode()\n``` 排查。",
        "队列消费者 /srv/worker/drain.py 内存持续上涨，stack trace 指向批量拼接逻辑，请给修复思路。",
        "请分析 /srv/cache/rebuilder.py 的循环重建问题，日志含 Traceback 且代码块如下 ```python\nfor key in keys:\n    rebuild(key)\n```",
        "生产环境 /srv/scheduler/timer.py 报 timeout 并触发级联失败，请定位根因并给出验证方案。",
        "路径 /srv/mail/sender.py 发生 Exception: broken pipe，附代码 ```python\nconn.sendall(data)\n```，请排查。",
        "文件 /srv/search/indexer.py 报 stack trace 且 CPU 飙升，请说明可疑点和修复路线。",
        "请分析 /srv/notify/pusher.py 的重试风暴问题，错误日志与代码块一起看：```python\nwhile True:\n    push()\n```",
        "线上 /srv/metrics/collector.py 出现 Traceback: KeyError 并影响上报，请定位问题。",
        "路径 /srv/payments/reconcile.py 报 warning: deadlock suspected，附代码 ```python\nwith txn:\n    update_all()\n``` 请分析。",
    ]
    for idx, prompt in enumerate(boundary_tier1, start=1):
        cases.append(
            _case(
                f"r4-t1-{idx:02d}",
                "round4_boundary",
                "tier1",
                prompt,
                max_tokens=768,
            )
        )

    boundary_tier3 = [
        "解释什么是幂等",
        "JWT 和 session 区别",
        "什么叫回滚",
        "解释一下 CDN",
        "什么是灰度发布",
        "Kafka 是啥",
        "什么是索引",
        "解释下限流",
        "啥叫监控告警",
        "什么是 SSE",
        "什么叫冷启动",
        "解释下主从复制",
        "什么是连接池",
        "解释下熔断",
        "什么是反压",
    ]
    for idx, prompt in enumerate(boundary_tier3, start=1):
        cases.append(
            _case(
                f"r4-t3-{idx:02d}",
                "round4_boundary",
                "tier3",
                prompt,
                max_tokens=64,
            )
        )

    assert len(cases) == 200, f"expected 200 cases, got {len(cases)}"
    return cases

