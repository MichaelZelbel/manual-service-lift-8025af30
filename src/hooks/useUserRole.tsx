import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "moderator" | "user";

export function useUserRole() {
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    checkUserRole();
  }, []);

  const checkUserRole = async () => {
    try {
      // For prototype: check localStorage for user
      const storedUser = localStorage.getItem("currentUser");
      if (!storedUser) {
        setLoading(false);
        return;
      }

      const user = JSON.parse(storedUser);
      
      // For prototype: mock user ID based on bNumber
      // Alice (BH2856) is the admin user
      // In production, this would use auth.uid()
      const mockUserId = user.bNumber === "BH2856" ? "00000000-0000-0000-0000-000000000000" : null;
      setUserId(mockUserId);

      if (!mockUserId) {
        setRole("user");
        setLoading(false);
        return;
      }

      // Check user role in database using the security definer function
      const { data, error } = await supabase.rpc("has_role", {
        _user_id: mockUserId,
        _role: "admin",
      });

      if (error) {
        console.error("Error checking role:", error);
        setRole("user");
      } else {
        setRole(data ? "admin" : "user");
      }
    } catch (error) {
      console.error("Error in checkUserRole:", error);
      setRole("user");
    } finally {
      setLoading(false);
    }
  };

  return { role, loading, userId, isAdmin: role === "admin" };
}
