'use client';

import { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';

// Define the shape of the user object
interface User {
  name: string;
}

// Define the shape of the context
interface AuthContextType {
  user: User | null;
  login: (name: string) => void;
  logout: () => void;
  isLoading: boolean;
}

// Create the context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Define the key for localStorage
const USER_STORAGE_KEY = 'ai_boyfriend_user';

// Create the provider component
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true); // To handle initial check

  // Check for saved user on initial load
  useEffect(() => {
    try {
      const savedUserJson = localStorage.getItem(USER_STORAGE_KEY);
      if (savedUserJson) {
        const savedUser = JSON.parse(savedUserJson);
        setUser(savedUser);
      }
    } catch (error) {
      console.error('Failed to parse user from localStorage', error);
      // Clear corrupted data
      localStorage.removeItem(USER_STORAGE_KEY);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback((name: string) => {
    const newUser: User = { name };
    try {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(newUser));
      setUser(newUser);
    } catch (error) {
      console.error('Failed to save user to localStorage', error);
    }
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(USER_STORAGE_KEY);
      setUser(null);
    } catch (error) {
      console.error('Failed to remove user from localStorage', error);
    }
  }, []);

  const value = { user, login, logout, isLoading };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

// Create a custom hook for easy access to the context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
