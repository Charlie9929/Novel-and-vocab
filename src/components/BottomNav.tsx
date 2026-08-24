export type AppTab = "reader" | "vocab" | "settings";

interface BottomNavProps {
  activeTab: AppTab;
  onChange: (tab: AppTab) => void;
  hidden?: boolean;
}

export function BottomNav({ activeTab, onChange, hidden = false }: BottomNavProps) {
  const tabs: Array<{ id: AppTab; label: string }> = [
    { id: "reader", label: "阅读" },
    { id: "vocab", label: "生词" },
    { id: "settings", label: "设置" },
  ];

  return (
    <nav className="bottom-nav" aria-label="主导航" hidden={hidden}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={activeTab === tab.id ? "active" : ""}
          type="button"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
