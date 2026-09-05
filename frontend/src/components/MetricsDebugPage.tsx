import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { api } from "../api/client";
import type { MetricsSummary } from "../types";

// Internal-only view, reached via /?debug=metrics — not linked from the
// normal nav (PRD §10). Shows the three metrics that are actually
// measurable right now regardless of the hotel dataset being small:
// AI推荐采纳率, 下单前平均对话轮次, AI推荐/入住体验满意度分布.
export function MetricsDebugPage() {
  const [data, setData] = useState<MetricsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.metrics().then(setData).catch(() => setError("加载失败，确认后端已启动"));
  }, []);

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100vh", padding: "24px 20px", fontFamily: "system-ui, sans-serif", color: "#16587b", background: "#F5EEDD" }}>
      <h1 style={{ fontSize: 18, marginBottom: 4 }}>指标调试页</h1>
      <p style={{ fontSize: 12, color: "#7a95a3", marginBottom: 20 }}>内部调试用，未接入主导航；数据随订单/追问真实产生而变化。</p>

      {error && <div style={{ color: "#b3462c", fontSize: 13 }}>{error}</div>}
      {!data && !error && <div style={{ fontSize: 13 }}>加载中…</div>}

      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="转化漏斗（打开预订弹层 → 确认 → 完成支付）">
            <Funnel
              stages={[
                { label: "打开预订弹层", n: data.funnel.sheetOpened },
                { label: "点击确认预订", n: data.funnel.confirmClicked },
                { label: "完成支付", n: data.funnel.paymentCompleted },
              ]}
            />
            <div style={metaStyle}>付款页点了就一定成功，所以"确认支付"这一步没有流失；"打开→确认"这一段的差额是真实的浏览未下单人数</div>
          </Card>

          <Card title="AI推荐采纳率">
            <BigNumber value={data.adoptionRatePct === null ? "—" : `${data.adoptionRatePct}%`} />
            <div style={metaStyle}>
              全部订单 {data.totalOrders} 单，其中通过AI聊天下单 {data.aiChatOrders} 单，手动筛选下单 {data.manualOrders} 单
            </div>
          </Card>

          <Card title="下单前平均对话轮次（仅AI聊天订单）">
            <BigNumber value={data.avgChatTurnsForAiOrders === null ? "—" : `${data.avgChatTurnsForAiOrders} 轮`} />
            <div style={metaStyle}>基于{data.aiChatOrders}单AI聊天订单，下单那一刻该会话已发送的用户消息数取平均</div>
          </Card>

          <Card title="AI推荐满意度（下单后追问，仅问AI聊天订单）">
            <Distribution
              rows={[
                { label: "满意", n: data.satisfaction.satisfied },
                { label: "一般", n: data.satisfaction.neutral },
                { label: "不满意", n: data.satisfaction.unsatisfied },
                { label: "跳过未答", n: data.satisfaction.skipped },
              ]}
            />
            <div style={metaStyle}>共{data.satisfaction.totalAnswered + data.satisfaction.skipped}次追问</div>
          </Card>

          <Card title="入住体验满意度（下单后追问，所有订单）">
            <Distribution
              rows={[
                { label: "很干净", n: data.stayExperience.clean },
                { label: "一般", n: data.stayExperience.ok },
                { label: "不太干净", n: data.stayExperience.dirty },
                { label: "跳过未答", n: data.stayExperience.skipped },
              ]}
            />
            <div style={metaStyle}>共{data.stayExperience.totalAnswered + data.stayExperience.skipped}次追问</div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: "14px 16px", boxShadow: "0 1px 4px rgba(22,88,123,.1)" }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: "#16587b" }}>{title}</div>
      {children}
    </div>
  );
}

function BigNumber({ value }: { value: string }) {
  return <div style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value}</div>;
}

function Funnel({ stages }: { stages: { label: string; n: number }[] }) {
  const base = stages[0]?.n || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].n : null;
        const dropPct = prev && prev > 0 ? Math.round(((prev - s.n) / prev) * 1000) / 10 : null;
        return (
          <div key={s.label}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: "#7a95a3" }}>{s.label}</span>
              <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{s.n}</span>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: "#EFE6D2", overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, (s.n / base) * 100)}%`, height: "100%", background: "#16587b" }} />
            </div>
            {dropPct !== null && dropPct > 0 && (
              <div style={{ fontSize: 10.5, color: "#b3462c", marginTop: 3 }}>↓ 较上一步流失 {dropPct}%</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Distribution({ rows }: { rows: { label: string; n: number }[] }) {
  const total = rows.reduce((s, r) => s + r.n, 0) || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <div style={{ width: 56, flexShrink: 0, color: "#7a95a3" }}>{r.label}</div>
          <div style={{ flex: 1, height: 8, borderRadius: 999, background: "#EFE6D2", overflow: "hidden" }}>
            <div style={{ width: `${(r.n / total) * 100}%`, height: "100%", background: "#16587b" }} />
          </div>
          <div style={{ width: 22, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.n}</div>
        </div>
      ))}
    </div>
  );
}

const metaStyle: CSSProperties = { fontSize: 11, color: "#7a95a3", marginTop: 6 };
