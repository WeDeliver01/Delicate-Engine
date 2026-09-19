import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function DriverLogin() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (token.trim()) {
      localStorage.setItem("driverToken", token.trim());
      setLocation("/driver/wallet");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md shadow-lg border-primary/10">
        <CardHeader className="space-y-1 pb-6">
          <CardTitle className="text-2xl font-serif text-center text-primary">Driver Portal</CardTitle>
          <CardDescription className="text-center">Enter your portal token to access your wallet</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token">Portal Token</Label>
              <Input 
                id="token" 
                type="password" 
                value={token} 
                onChange={(e) => setToken(e.target.value)} 
                placeholder="dt_..."
                autoComplete="off"
              />
            </div>
            <Button type="submit" className="w-full h-11 text-base shadow-sm">Access Wallet</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
