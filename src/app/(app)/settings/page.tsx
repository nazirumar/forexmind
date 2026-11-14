import { SettingsForm } from "@/components/settings/settings-form";
import { AccountsCard } from "@/components/settings/accounts-card";

export const metadata = { title: "Settings - ForexMind" };

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <SettingsForm />
      <AccountsCard />
    </div>
  );
}
