import { AuthForm } from "@/components/auth/auth-form";

export const metadata = { title: "Sign in - ForexMind" };

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
