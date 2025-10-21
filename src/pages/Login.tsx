import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";

// Hardcoded users
const USERS = [{
  bNumber: "BH2856",
  password: "EpyTi3zGfRw0",
  name: "Alice",
  role: "Admin"
}, {
  bNumber: "BH5534",
  password: "LCAGg4t8tu1b",
  name: "Bob",
  role: "User"
}, {
  bNumber: "BH7567",
  password: "7qW0dhF3YNbe",
  name: "Mallory",
  role: "User"
}];
const Login = () => {
  const [bNumber, setBNumber] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    // Simulate network delay for more realistic UX
    await new Promise(resolve => setTimeout(resolve, 500));
    const user = USERS.find(u => u.bNumber === bNumber && u.password === password);
    if (user) {
      // Store user info in localStorage
      localStorage.setItem("currentUser", JSON.stringify(user));
      toast({
        title: "Login successful",
        description: `Welcome back, ${user.name}!`
      });
      navigate("/dashboard");
    } else {
      setError("Incorrect B-Number or password.");
      setIsLoading(false);
    }
  };
  return <div className="min-h-screen flex items-center justify-center bg-background px-4 animate-fade-in">
      <div className="w-full max-w-md">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-primary mb-3">
            Manual Service Lift
          </h1>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            Turning messy manual services into clean Camunda workflows — with a little AI magic.
          </p>
        </div>

        {/* Login Card */}
        <Card className="shadow-lg border-border">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-semibold text-center">
              Welcome back
            </CardTitle>
            <CardDescription className="text-center">
              Enter your credentials to access your account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="bNumber">B-Number</Label>
                <Input id="bNumber" type="text" placeholder="BH1234" value={bNumber} onChange={e => setBNumber(e.target.value)} required autoFocus className="bg-card" />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" placeholder="Enter your password" value={password} onChange={e => setPassword(e.target.value)} required className="bg-card" />
              </div>

              {error && <div className="text-destructive text-sm font-medium bg-destructive/10 px-3 py-2 rounded-md">
                  {error}
                </div>}

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Logging in..." : "Log in"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Footer */}
        <footer className="mt-8 text-center text-xs text-muted-foreground">
          <p>Prototype v0.1 · © Internal Use Only</p>
        </footer>
      </div>
    </div>;
};
export default Login;