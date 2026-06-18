export function SectionAttentionBadge({ count, order }: { count?: number; order?: number }) {
  if (order != null && order > 0) {
    return <span className="section-attention-badge section-attention-badge--order">{order}</span>;
  }
  if (!count || count <= 0) return null;
  return <span className="section-attention-badge">{count > 99 ? "99+" : count}</span>;
}
