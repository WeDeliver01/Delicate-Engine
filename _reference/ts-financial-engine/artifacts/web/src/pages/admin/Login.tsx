import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function AdminLogin() {
  const [, setLocation] = useLocation();
  const [key, setKey] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (key.trim()) {
      localStorage.setItem("adminToken", key.trim());
      setLocation("/admin/dashboard");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md shadow-lg border-primary/10">
        <CardHeader className="space-y-1 pb-6">
          <CardTitle className="text-2xl font-serif text-center text-primary">Delicate Financial Engine</CardTitle>
          <CardDescription className="text-center">Enter your administrative API key to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input 
                id="apiKey" 
                type="password" 
                value={key} 
                onChange={(e) => setKey(e.target.value)} 
                placeholder="sk_admin_..."
                autoComplete="off"
              />
            </div>
            <Button type="submit" className="w-full h-11 text-base shadow-sm">Access Command Center</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
