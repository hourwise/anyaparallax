type PlaceholderNoticeProps = {
  children: React.ReactNode;
  /** "warning" marks content that is deliberately unsecured or incomplete. */
  tone?: "default" | "warning";
};

export function PlaceholderNotice({ children, tone = "default" }: PlaceholderNoticeProps) {
  return <p className={`notice notice--${tone}`}>{children}</p>;
}
