"use client";

/**
 * Settings form - edit the user's profile + trading defaults.
 *
 * Fetches the profile on mount, lets the user edit display name +
 * default balance + default risk % + preferred session + default pair,
 * and PUTs to /api/profile on save.
 *
 * All fields are optional - the user can leave any blank and the
 * risk calculator / journal will fall back to their own hardcoded
 * defaults.
 *
 * The form is always usable; /api/profile (Prisma-backed) returns 401
 * when there's no session, in which case the form stays empty and a
 * save attempt surfaces a "Sign in to save your settings" error.
 */
import { useEffect, useState, FormEvent } from "react";
import { Settings, Loader2, AlertTriangle, CheckCircle2, Save } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PAIRS, SESSIONS, type ProfileRow } from "@/lib/profile/schema";

type FormState = {
  display_name: string;
  default_balance: string;
  default_risk_pct: string;
  preferred_session: string;
  default_pair: string;
};

export function SettingsForm() {
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<FormState>({
    display_name: "",
    default_balance: "",
    default_risk_pct: "",
    preferred_session: "",
    default_pair: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    try {
      const res = await fetch("/api/profile");
      if (res.status === 401) {
        setLoaded(true);
        return;
      }
      if (!res.ok) return;
      const data: ProfileRow = await res.json();
      setProfile(data);
      setForm({
        display_name: data.display_name ?? "",
        default_balance: data.default_balance != null ? String(data.default_balance) : "",
        default_risk_pct: data.default_risk_pct != null ? String(data.default_risk_pct) : "",
        preferred_session: data.preferred_session ?? "",
        default_pair: data.default_pair ?? "",
      });
    } catch {
      // Ignore - form stays empty.
    } finally {
      setLoaded(true);
    }
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);

    // Build the patch - only include non-empty fields.
    const patch: Record<string, unknown> = {};
    if (form.display_name.trim()) patch.display_name = form.display_name.trim();
    if (form.default_balance) {
      const n = Number(form.default_balance);
      if (Number.isFinite(n) && n > 0) patch.default_balance = n;
    } else {
      patch.default_balance = null;
    }
    if (form.default_risk_pct) {
      const n = Number(form.default_risk_pct);
      if (Number.isFinite(n) && n >= 0) patch.default_risk_pct = n;
    } else {
      patch.default_risk_pct = null;
    }
    if (form.preferred_session) {
      patch.preferred_session = form.preferred_session;
    } else {
      patch.preferred_session = null;
    }
    if (form.default_pair) {
      patch.default_pair = form.default_pair;
    } else {
      patch.default_pair = null;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setError("Sign in to save your settings.");
        } else {
          setError(body?.error ?? `Failed (HTTP ${res.status})`);
        }
        return;
      }
      const data: ProfileRow = await res.json();
      setProfile(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Network error - please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" aria-hidden="true" />
        Loading your settings...
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Edit your display name and default trading parameters. These pre-fill the risk calculator and journal."
        icon={<Settings className="h-5 w-5" />}
      />

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-6">
        {/* Account section */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="display_name">Display name</Label>
              <Input
                id="display_name"
                placeholder="Trader Joe"
                value={form.display_name}
                onChange={(e) => set("display_name", e.target.value)}
                maxLength={60}
              />
              <p className="text-[11px] text-muted-foreground">
                Shown in the sidebar instead of your email when set.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Trading defaults */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Trading defaults</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              These pre-fill the Risk Calculator and Trade Journal forms.
              Leave any blank to use the app&apos;s built-in defaults.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="default_balance">Default account balance ($)</Label>
                <Input
                  id="default_balance"
                  type="number"
                  inputMode="decimal"
                  step="100"
                  min="0"
                  placeholder="10000"
                  value={form.default_balance}
                  onChange={(e) => set("default_balance", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="default_risk_pct">Default risk per trade (%)</Label>
                <Input
                  id="default_risk_pct"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  max="100"
                  placeholder="1"
                  value={form.default_risk_pct}
                  onChange={(e) => set("default_risk_pct", e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="default_pair">Default pair</Label>
                <Select
                  value={form.default_pair}
                  onValueChange={(v) => set("default_pair", v === "none" ? "" : v)}
                >
                  <SelectTrigger id="default_pair">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— (use app default)</SelectItem>
                    {PAIRS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p.slice(0, 3)}/{p.slice(3)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="preferred_session">Preferred session</Label>
                <Select
                  value={form.preferred_session}
                  onValueChange={(v) => set("preferred_session", v === "none" ? "" : v)}
                >
                  <SelectTrigger id="preferred_session">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— (no preference)</SelectItem>
                    {SESSIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s[0]!.toUpperCase() + s.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Error + save bar */}
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span className="ml-1">Saving...</span>
              </>
            ) : (
              <>
                <Save className="h-4 w-4" aria-hidden="true" />
                <span className="ml-1">Save settings</span>
              </>
            )}
          </Button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-500">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Saved
            </span>
          )}
          {profile && (
            <span className="text-[11px] text-muted-foreground ml-auto">
              Last updated: {new Date(profile.updated_at).toLocaleString()}
            </span>
          )}
        </div>
      </form>

      <p className="mt-8 text-[11px] leading-relaxed text-muted-foreground">
        Not financial advice. Trading forex involves substantial risk of loss.
      </p>
    </>
  );
}
