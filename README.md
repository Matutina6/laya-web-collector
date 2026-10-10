# Real-pilot Web Collector

工程核验文档见：

```text
docs/ARCHITECTURE_AND_TRAINING_DESIGN.md
```

这是一个面向真实数据 pilot 的 **real-pilot-v2** 采集后端：

```text
患者页：只看到主诉、医生问题和对话，不看到 target fact / channel / AI 候选
医生页：选择目标事实、确认问题、录入回答、查看事实账本
裁定页：独立标记 acquired / recorded / usable / actionable
后端：FastAPI + PostgreSQL/SQLite，LLM 只产生 candidate
导出：route_samples_v2.jsonl + success_*.jsonl + split_manifest + manifest/checksum
```

异步交互模式：

```text
Structured：async
LLM：async
Human：sync by default
Human：semi_async_human only when explicitly requested
```

问题状态机：

```text
planned -> generated -> approved -> queued -> delivered -> viewed -> answered
                                      \-> cancelled / expired
```

患者通过短期链接访问：

```text
/patient?token=...
```

real-pilot-v2 额外实现：

```text
target-fact-level blocked randomization
assignment_schedule / randomization_blocks
no_response / refused / off_topic / system_error
independent adjudication + two-rater consensus
versioned label codebook
LLM call full metadata
split leakage validation
multi-head export:
    acquired
    recorded
    usable
    actionable
```

## 1. 本地运行

```bash
cd /home/matut/Projects/laya/research/clinical_router/real_pilot/web_collector
python3 -m venv /tmp/laya-web-venv
source /tmp/laya-web-venv/bin/activate
pip install -r requirements.txt
cp env.example .env
# 编辑 .env，至少填写 LLM_API_KEY；不填则使用确定性 fallback extractor
uvicorn backend.app:app --host 127.0.0.1 --port 8080
```

打开：

```text
http://127.0.0.1:8080/          控制台
http://127.0.0.1:8080/doctor    医生采集页
http://127.0.0.1:8080/patient   患者对话页
http://127.0.0.1:8080/adjudicator 独立裁定页
```

默认使用 `local_pilot.sqlite3` 和自动 seed demo encounter，适合本地验收 UI。生产环境应关闭：

```dotenv
APP_ENV=production
AUTO_SEED_DEMO=0
AUTH_MODE=gateway
AUTH_GATEWAY_SECRET=<long random secret>
CORS_ORIGINS=https://collector.example.com
```

`AUTH_MODE=gateway` 要求可信网关校验用户后注入 `X-User-Id` / `X-User-Role` /
`X-Gateway-Secret`；浏览器直接伪造这些 header 会被拒绝。
`X-User-Role` 同时决定接口权限（curator/admin 才能传 `randomization_seed`）。

## 2. 托管部署（Supabase + 常驻容器，推荐路径）

```text
research/clinical_router/real_pilot/web_collector/deploy/SUPABASE_MIGRATION_GUIDE.md
research/clinical_router/real_pilot/web_collector/deploy/HOSTED_DEPLOYMENT.md
research/clinical_router/real_pilot/web_collector/deploy/SUPABASE_MIGRATION_REPORT.md
research/clinical_router/real_pilot/web_collector/deploy/SUPABASE_DEPLOYMENT_AND_TESTING.md
```

- Postgres schema 的唯一来源是 `supabase/migrations/`（`schema.sql` 只是指针），执行方式见
  `supabase/README.md`；
- 托管运行使用 `AUTH_MODE=supabase`、`STORAGE_BACKEND=supabase`、`DB_AUTO_CREATE=0`、
  `AUTO_SEED_DEMO=0`；`APP_ENV=production` 的启动守卫会拒绝其他组合；
- 容器与 TLS：`Dockerfile` + `deploy/compose.supabase.yml` + `deploy/Caddyfile.example`；
  环境变量模板是 `deploy/env.supabase.example`（chmod 600，不进 Git）；
- 本部署只允许合成数据 / 标准化病人（`ALLOW_REAL_PATIENT_DATA=0`），真实患者数据不在本次范围；
- 创建 Supabase/云主机、在生产库执行 migration、导入历史数据、DNS 切换、删除旧 RDS/ECS
  都必须先获得用户明确确认（迁移指南 §0.3）。确认前只做本地 / staging 验证。

## 2b. 阿里云部署（备选方案）

### 2.1 推荐拓扑

```text
公网 / VPN
  -> SLB / Nginx
  -> ECS / ACK running FastAPI
  -> RDS PostgreSQL（或自托管 Supabase Postgres）
  -> Redis（后续异步 worker）
  -> OSS（音频、导出文件）
  -> KMS / Secrets Manager（LLM key、数据库密码）
  -> SLS（审计和错误日志）
```

真实患者数据建议部署在阿里云 VPC 内。Supabase Cloud 不是阿里云的托管产品；如果需要中国大陆数据治理，请使用自托管 Postgres/Supabase 兼容栈，或直接使用 RDS PostgreSQL + FastAPI。

### 2.2 初始化数据库（备选路径）

顶层 `schema.sql` 已改成指向 `supabase/migrations/` 的指针；新的初始化流程见
`supabase/README.md`（`pilot` schema、三遍执行、`laya_app` 角色与 RLS）。旧的
`schema_rls_example.sql` 已移到 `deploy/legacy/` 并标注过时（其中的
`auth.jwt()->>'role'` 在 Supabase 上恒为 `authenticated`，不能承载业务角色）。

如果确实需要复现迁移前的阿里云脚本，请在基线提交 `2fe78e6` 中取回旧的 `schema.sql` /
`schema_rls_example.sql`，不要在当前分支恢复 `public` schema 的建表方式。

本项目的临床写入默认全部经过 FastAPI，不要求浏览器直接写表。

### 2.3 配置环境变量

```dotenv
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@PRIVATE_HOST:5432/laya_pilot?sslmode=require
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=...
LLM_QUESTION_MODEL=qwen3.8-max
LLM_EXTRACTOR_MODEL=qwen3.8-flash
AUTH_MODE=gateway
AUTH_GATEWAY_SECRET=...
CORS_ORIGINS=https://collector.example.com
AUTO_SEED_DEMO=0
```

不要把 `LLM_API_KEY` 放进浏览器、前端构建产物或 Git。生产环境建议从 KMS/Secrets Manager 注入。

### 2.4 启动

```bash
uvicorn backend.app:app --host 0.0.0.0 --port 8080 --workers 1
```

托管部署固定 1 个 API worker + 1 个 worker 容器（见迁移指南 W6.6/W9.1）；本备选路径如果要
加 worker 数，需要先把登录限流和后台任务迁移到外部存储。

用 Nginx/SLB 终止 TLS。对象存储音频走 OSS 签名直传，数据库只保存 `audio_object_key`。

## 3. 数据流

```text
医生选择 target fact
  -> start_attempt
  -> 冻结 route_state_snapshots 中的 pre-attempt visible state
  -> 随机/分块分配 channel
  -> create_question
  -> 患者回答
  -> Structured: 确定性 parser
     LLM: LLM extractor + validator
     Human: 医生手工记录
  -> fact_assertion_candidates
  -> fact_state_events / fact_current_state
  -> 独立裁定 attempt_outcomes
  -> export
```

## 4. 裁定和随机化

冻结标签定义：

```text
LABEL_CODEBOOK.md
data/label_codebook_v1.json
```

默认要求两名独立裁定者：

```dotenv
ADJUDICATION_REVIEWS_REQUIRED=2
REQUIRE_CONSENSUS_FOR_EXPORT=1
REQUIRE_SPLIT_METADATA=0
```

裁定者不能与：

```text
interviewer_id
patient_actor_id
```

相同。四个标签中出现不一致时，必须先进入争议裁定，只有 `adjudication_consensus.status=final` 的 attempt 才能导出。

channel 分配使用：

```text
randomization_blocks
assignment_schedule
```

默认策略 `stratified_simple`：

```dotenv
RANDOMIZATION_STRATEGY=stratified_simple
RANDOMIZATION_SCHEDULE_VERSION=target-fact-stratified-simple-v2
```

```text
1. 每个 (topic, target_fact) 一个 block，block 持有服务端私钥 salt。
2. 抽签 = HMAC(salt, encounter_seed, sequence_index) % 3，propensity 恒为 1/3。
3. encounter_seed 是每个 encounter 独立的 63 位密钥随机数。
4. 抽签不依赖 visible state、患者回答或医生输入。
```

不要设置 `RANDOMIZATION_DETERMINISTIC_SEED`，它只用于本地可复现测试。

分配隐藏证据（单步识别的前提）：

```text
target_declared_at     医生确定 target 的时间（医生页会主动上报）
target_declared_source client / server_receipt / client_clamped
channel_revealed_at    分配结果生成时间
不变式                  target_declared_at <= channel_revealed_at
```

医生角色不能传入 `randomization_seed`（403）；encounter API 也不返回 seed。

导出的训练臂默认按 ITT：

```text
analysis_population = itt            arm = assigned_channel（默认，可识别）
analysis_population = per_protocol   arm = executed_channel（有选择偏倚）
```

## 4.1 异步问题 API

```text
POST /api/attempts/{attempt_id}/question/plan
POST /api/questions/{question_event_id}/approve
POST /api/questions/{question_event_id}/queue
POST /api/attempts/{attempt_id}/question/revise
POST /api/encounters/{encounter_id}/patient-session-link
GET  /api/patient/session/{token}
POST /api/patient/session/{token}/questions/{question_event_id}/view
POST /api/patient/session/{token}/questions/{question_event_id}/answer
POST /api/questions/jobs/process
POST /api/questions/expire
```

独立 worker：

```bash
python scripts/process_question_jobs.py
```

## 4.2 并行采集和批量断点

并行采集：

```text
多个 encounter 同时运行
encounter_assignments 负责医生归属
case_runs 负责 patient/doctor/run 状态
patient_actors.max_parallel_runs 控制同一演员的并行 session 数
```

批量断点：

```text
case_batches
case_runs
doctor_rounds
doctor_tasks
doctor_documents
run_events
```

API：

```text
POST /api/patient-actors
POST /api/case-batches
GET  /api/patient-actors/{actor_id}/runs
GET  /api/interviewers/{interviewer_id}/encounters
POST /api/encounter-assignments
POST /api/case-runs/{run_id}/pause
POST /api/case-runs/{run_id}/resume
POST /api/case-runs/resume-ready
POST /api/doctor-rounds
POST /api/doctor-tasks
POST /api/doctor-rounds/{round_id}/workbook
POST /api/doctor-rounds/{round_id}/import
```

批量 workbook 生成 CSV + JSONL。
CSV 给医生填写，JSONL 用于机器导入。

## 4.3 导出时的样本量与偏差门禁

每次导出都会写出：

```text
coverage
    per_target_fact_arm        按 distinct attempt 计数（不是导出行数）
    per_head_target_fact_arm   四个 head 各自的单元格
    per_split_arm
    mdd                        该单元格在 80% power 下能分辨的最小绝对差

adjudication_backlog
    attempts / finalized / pending / pending_with_disagreement / pending_rate
```

`mdd` 的用途是让"这个单元格能不能回答这个问题"变成可见数字：

```text
30 次/臂   -> mdd ≈ 0.26，只够估一个按事实的截距
800 次/臂  -> mdd ≈ 0.05
```

`adjudication_backlog` 记录的是：只有 final consensus 会进导出，
所以大量 pending 意味着训练集是"容易达成一致"的子集。

可选门禁（默认关闭，设为大于 0 即生效）：

```json
{
  "min_cell_size": 30,
  "max_pending_rate": 0.1,
  "baseline_success_rate": 0.85
}
```

不满足时导出直接失败，而不是静默产出一个偏斜的数据集。

## 4.4 模型输入与训练目标一致

文档定义的目标是：

```text
P(success | visible_state, target_fact, question_text, channel)
```

因此 success row 现在显式包含：

```json
{
  "action": {
    "channel": "Structured",
    "arm_basis": "assigned",
    "question_text": "有没有喘不上气、咳血、发烧或者腿肿？",
    "question_source": "structured_template",
    "question_known_at_decision": true
  },
  "state": {
    "question_text": "有没有喘不上气、咳血、发烧或者腿肿？",
    "action_channel": "Structured"
  }
}
```

`question_known_at_decision` 标记问题文本在选 channel 时是否已经存在：

```text
Structured / Human  -> true（问题先写好，再选通道）
LLM                 -> false（问题由被选的通道自己生成）
```

这个标记必须保留，否则会把"用了未来信息"的特征混进路由模型。

## 5. 训练字段对应

每次 `fact_attempt` 保存：

```text
target_fact_id / slot_key
assigned_channel / executed_channel / interaction_mode / propensity / execution_propensity
pre-attempt state snapshot + state_hash
question_text / question_source
answer turn
target_declared_at / channel_revealed_at      分配隐藏证据
is_retry / previous_attempt_id / selection_reason
duration_ms / resource_units
LLM model / prompt version / latency / retries
candidates + validation status
acquired / recorded / usable / actionable
case split role / site / interviewer
```

导出后：

```text
route_samples_v2.jsonl    每次 attempt 一行，包含四个 consensus 标签和失败事件
success_train.jsonl       每条 训练臂 × head Bernoulli 样本
success_calib.jsonl
success_valid.jsonl
success_test.jsonl
success_heldout_shift.jsonl
encounter_outcomes.jsonl  encounter 级效用与物理成本汇总
split_manifest.json       分组和 heldout 约束
inter_rater_metrics.json  按 head / fact / channel 的裁定一致性
manifest.json             coverage / mdd / adjudication_backlog / sample_size_policy
checksums.txt
```

`success_*.jsonl` 的训练臂由 `analysis_population` 决定：

```text
itt（默认）       臂 = assigned_channel；override 留在 audit 里
per_protocol      臂 = executed_channel；有选择偏倚，不能单独做因果解释
```

导出行同时写入模型可见的 `state.question_text` 与 `state.action_channel`，
以及显式 `action` 块（含 `question_known_at_decision`），
使训练输入与文档定义的目标 `P(success | visible_state, target_fact, question_text, channel)` 一致。

`success_*.jsonl` 的 `head` 包括：

```text
acquired
recorded
usable
actionable
```

`state` 必须是 attempt 前快照，不能含目标回答、未来 turn、hidden fact 或裁定标签。
`question_variant_id` 只作为 audit，不作为模型特征。
`state.success_context` 只放 attempt 之前已固定的协变量（SP 剧本声明），不从患者回答反推。

## 5. 三种 channel 的界面行为

```text
Structured
  使用 reviewed question template，回答走确定性 parser。

LLM
  使用 LLM 生成问题；回答由真实 LLM + validator 抽取；
  保存真实模型和 prompt 版本，不再用手写 success 公式。

Human
  医生自由询问和手工记录；不使用 LLM 自动抽取。
  如果允许实时 AI 辅助，应新增 Human+LLM channel，不能混入 Human。
```

## 6. 独立裁定

裁定页默认隐藏 channel 和 AI 置信度。四标签定义：

```text
acquired   患者是否实际回答了与 target fact 相关的内容
recorded   系统/医生是否正确记录了这个事实
usable     该记录是否足以解决 target fact
actionable 是否足以支持下一步临床动作
```

LLM 不能写 `usable`。`usable=uncertain` 的 attempt 默认不进入 success-head export。

## 7. 本地验证

需要 fastapi / sqlalchemy / httpx / pydantic。依赖缺失时相关测试会被 skip
并说明原因，不会静默通过。若依赖装在仓库内的本地目录（例如 `.laya-web-deps/`）：

```bash
cd /home/matut/Projects/laya

# 契约测试：随机化、分配隐藏不变式、schema 与 ORM 漂移、样本量数学
PYTHONPATH=<deps>:. python3 -m unittest discover -s research/clinical_router/real_pilot/web_collector/tests -t . -q

# 端到端 smoke：异步问题队列、患者短期链接、双评 consensus、ITT 导出、门禁
cd research/clinical_router/real_pilot/web_collector
PYTHONPATH=<deps>:. python3 scripts/smoke_api.py
```

smoke test 会实际断言：

```text
分配策略为 stratified_simple 且 propensity 恒为 1/3
target_declared_at <= channel_revealed_at
encounter API 不返回 randomization_seed
患者短期链接只能看到本 encounter 的待答问题
双评才产生 final consensus，执行医生不能裁定自己
success row 的 arm == audit.arm（ITT），且 state 含 question_text / action_channel
coverage 按 distinct attempt 计数并给出 mdd
max_pending_rate 门禁会拒绝 pending 过多的导出
```

## 8. 上线前必须确认

```text
[ ] 真实数据是否允许落在当前阿里云地域
[ ] 是否已完成伦理/知情同意/数据保留期评审
[ ] LLM API key 是否放在 KMS/Secrets Manager
[ ] 是否关闭 AUTO_SEED_DEMO
[ ] 是否启用 AUTH_MODE=gateway 并配置 AUTH_GATEWAY_SECRET / CORS_ORIGINS
[ ] 是否配置数据库 PITR / 备份
[ ] 是否明确 Human channel 不允许 AI 实时辅助
[ ] 是否明确裁定者独立于执行 channel 的医生
[ ] 是否确认未设置 RANDOMIZATION_DETERMINISTIC_SEED
[ ] 是否确认医生角色无法传入 randomization_seed（应为 403）
[ ] 是否确认两名独立裁定者已就位，且分歧队列有完成时限
[ ] 是否确认导出开启 REQUIRE_CONSENSUS_FOR_EXPORT / REQUIRE_SPLIT_METADATA
[ ] 是否按 mdd 确定本批次的 min_cell_size，而不是导出成功就开训
```

## Deployment guides

托管部署（推荐）：

```text
research/clinical_router/real_pilot/web_collector/deploy/SUPABASE_MIGRATION_GUIDE.md
research/clinical_router/real_pilot/web_collector/deploy/HOSTED_DEPLOYMENT.md
research/clinical_router/real_pilot/web_collector/deploy/SUPABASE_MIGRATION_REPORT.md
```

阿里云部署（备选方案）：

```text
research/clinical_router/real_pilot/web_collector/deploy/ALIYUN_DEPLOYMENT_GUIDE.md
research/clinical_router/real_pilot/web_collector/deploy/README_ALIYUN.md
```
