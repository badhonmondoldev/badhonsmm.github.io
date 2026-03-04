import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import nodemailer from "nodemailer";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const db = new Database("smm.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password TEXT,
    balance REAL DEFAULT 0.0,
    is_admin INTEGER DEFAULT 0,
    is_verified INTEGER DEFAULT 0,
    verification_token TEXT
  );
`);

// Migration: Add email column if it doesn't exist
const tableInfo = db.prepare("PRAGMA table_info(users)").all() as any[];
if (!tableInfo.some(col => col.name === 'email')) {
  db.exec("ALTER TABLE users ADD COLUMN email TEXT");
}
if (!tableInfo.some(col => col.name === 'is_verified')) {
  db.exec("ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0");
}
if (!tableInfo.some(col => col.name === 'verification_token')) {
  db.exec("ALTER TABLE users ADD COLUMN verification_token TEXT");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS payment_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    method TEXT,
    amount REAL,
    trx_id TEXT UNIQUE,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    category TEXT,
    rate REAL,
    min INTEGER,
    max INTEGER,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    service_id INTEGER,
    link TEXT,
    quantity INTEGER,
    status TEXT DEFAULT 'pending',
    charge REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(service_id) REFERENCES services(id)
  );
`);

// Seed some initial services if empty
const serviceCount = db.prepare("SELECT COUNT(*) as count FROM services").get() as { count: number };
if (serviceCount.count === 0) {
  const insertService = db.prepare("INSERT INTO services (name, category, rate, min, max, description) VALUES (?, ?, ?, ?, ?, ?)");
  insertService.run("Instagram Followers [Real]", "Instagram", 1.5, 100, 10000, "High quality real followers for your Instagram profile.");
  insertService.run("Instagram Likes [Fast]", "Instagram", 0.5, 50, 5000, "Instant likes for your posts.");
  insertService.run("YouTube Views [Non-Drop]", "YouTube", 3.0, 1000, 50000, "Stable views for your YouTube videos.");
  insertService.run("Facebook Page Likes", "Facebook", 2.0, 100, 10000, "Boost your Facebook page presence.");
}

// Seed admin user
const adminUser = db.prepare("SELECT * FROM users WHERE username = 'badhon'").get() as any;
if (!adminUser) {
  const hashedPassword = bcrypt.hashSync("badhon2006", 10);
  db.prepare("INSERT INTO users (username, email, password, balance, is_admin, is_verified) VALUES (?, ?, ?, ?, ?, ?)").run("badhon", "badhon@smmpro.com", hashedPassword, 1000.0, 1, 1);
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // Email Transporter
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port: parseInt(process.env.EMAIL_PORT || "587"),
    secure: process.env.EMAIL_SECURE === "true",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  // Auth Routes (Simplified for demo)
  app.post("/api/auth/register", async (req, res) => {
    const { username, email, password } = req.body;
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const hashedPassword = bcrypt.hashSync(password, 10);
    try {
      // Set is_verified = 1 by default to simplify login as requested
      const info = db.prepare("INSERT INTO users (username, email, password, balance, verification_token, is_verified) VALUES (?, ?, ?, ?, ?, ?)").run(username, email, hashedPassword, 0.0, verificationToken, 1);
      
      // Send Verification Email (Optional now, won't block login)
      const appUrl = process.env.APP_URL || `http://localhost:3000`;
      const verificationLink = `${appUrl}/verify?token=${verificationToken}`;

      const mailOptions = {
        from: `"badhon smm" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Verify your account",
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #10b981;">Welcome to badhon smm!</h2>
            <p>Please click the button below to verify your account and start using our services.</p>
            <a href="${verificationLink}" style="display: inline-block; padding: 12px 24px; background-color: #10b981; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 10px;">Verify Account</a>
            <p style="margin-top: 20px; font-size: 12px; color: #666;">If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="font-size: 12px; color: #666;">${verificationLink}</p>
          </div>
        `,
      };

      if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        await transporter.sendMail(mailOptions);
      } else {
        console.log("Email credentials not set. Verification link:", verificationLink);
      }

      res.json({ success: true, userId: info.lastInsertRowid, message: "Verification email sent!" });
    } catch (e) {
      console.error(e);
      res.status(400).json({ error: "Username or Email already exists" });
    }
  });

  app.get("/verify", (req, res) => {
    const { token } = req.query;
    const user = db.prepare("SELECT * FROM users WHERE verification_token = ?").get(token) as any;
    if (user) {
      db.prepare("UPDATE users SET is_verified = 1, verification_token = NULL WHERE id = ?").run(user.id);
      res.send(`
        <html>
          <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #000; color: #fff; margin: 0;">
            <div style="text-align: center; background: #111; padding: 40px; border-radius: 32px; border: 1px solid #222; max-width: 400px; width: 90%; box-shadow: 0 20px 50px rgba(0,0,0,0.5);">
              <div style="width: 80px; height: 80px; background: #10b981; border-radius: 24px; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px;">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </div>
              <h1 style="color: #fff; font-size: 28px; font-weight: 900; margin-bottom: 12px; letter-spacing: -0.5px;">Verification Successful!</h1>
              <p style="color: #666; line-height: 1.6; margin-bottom: 32px;">Your account has been verified. You can now log in to your dashboard.</p>
              <a href="/" style="display: block; padding: 18px; background: #10b981; color: #000; text-decoration: none; border-radius: 16px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; font-size: 14px; transition: transform 0.2s;">Go to Login</a>
            </div>
          </body>
        </html>
      `);
    } else {
      res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #000; color: #fff; margin: 0;">
            <div style="text-align: center; background: #111; padding: 40px; border-radius: 32px; border: 1px solid #222; max-width: 400px; width: 90%;">
              <h1 style="color: #ef4444; font-size: 28px; font-weight: 900; margin-bottom: 12px;">Verification Failed</h1>
              <p style="color: #666; line-height: 1.6; margin-bottom: 32px;">Invalid or expired verification token. Please try registering again or contact support.</p>
              <a href="/" style="display: block; padding: 18px; background: #222; color: #fff; text-decoration: none; border-radius: 16px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; font-size: 14px;">Back to Home</a>
            </div>
          </body>
        </html>
      `);
    }
  });

  app.post("/api/auth/login", (req, res) => {
    const { login, password } = req.body; // login can be username or email
    const user = db.prepare("SELECT * FROM users WHERE (username = ? OR email = ?)").get(login, login) as any;
    
    if (user && bcrypt.compareSync(password, user.password)) {
      // Removed strict verification check to simplify login as requested
      res.json({ success: true, user: { id: user.id, username: user.username, email: user.email, balance: user.balance, is_admin: user.is_admin } });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  // Admin Routes
  app.get("/api/admin/users", (req, res) => {
    const users = db.prepare("SELECT id, username, balance, is_admin FROM users").all();
    res.json(users);
  });

  app.post("/api/admin/users/:id/balance", (req, res) => {
    const { amount } = req.body;
    db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(amount, req.params.id);
    res.json({ success: true });
  });

  app.get("/api/admin/orders", (req, res) => {
    const orders = db.prepare(`
      SELECT o.*, s.name as service_name, u.username 
      FROM orders o 
      JOIN services s ON o.service_id = s.id 
      JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
    `).all();
    res.json(orders);
  });

  app.post("/api/admin/services", (req, res) => {
    const { name, category, rate, min, max, description } = req.body;
    const info = db.prepare("INSERT INTO services (name, category, rate, min, max, description) VALUES (?, ?, ?, ?, ?, ?)").run(name, category, rate, min, max, description);
    res.json({ success: true, id: info.lastInsertRowid });
  });

  app.put("/api/admin/services/:id", (req, res) => {
    const { name, category, rate, min, max, description } = req.body;
    db.prepare("UPDATE services SET name = ?, category = ?, rate = ?, min = ?, max = ?, description = ? WHERE id = ?").run(name, category, rate, min, max, description, req.params.id);
    res.json({ success: true });
  });

  app.delete("/api/admin/services/:id", (req, res) => {
    db.prepare("DELETE FROM services WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.get("/api/admin/payments", (req, res) => {
    const payments = db.prepare(`
      SELECT p.*, u.username 
      FROM payment_requests p 
      JOIN users u ON p.user_id = u.id 
      ORDER BY p.created_at DESC
    `).all();
    res.json(payments);
  });

  app.post("/api/admin/payments/:id/approve", (req, res) => {
    const payment = db.prepare("SELECT * FROM payment_requests WHERE id = ?").get(req.params.id) as any;
    if (payment && payment.status === 'pending') {
      db.prepare("UPDATE payment_requests SET status = 'approved' WHERE id = ?").run(req.params.id);
      db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(payment.amount, payment.user_id);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: "Payment not found or already processed" });
    }
  });

  app.post("/api/admin/payments/:id/reject", (req, res) => {
    db.prepare("UPDATE payment_requests SET status = 'rejected' WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/admin/change-password", (req, res) => {
    const { userId, newPassword } = req.body;
    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashedPassword, userId);
    res.json({ success: true });
  });

  app.post("/api/admin/orders/:id/status", (req, res) => {
    const { status } = req.body;
    db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, req.params.id);
    res.json({ success: true });
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    const { email } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
    
    if (!user) {
      return res.status(404).json({ error: "User not found with this email." });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    db.prepare("UPDATE users SET verification_token = ? WHERE id = ?").run(resetToken, user.id);

    const appUrl = process.env.APP_URL || `http://localhost:3000`;
    const resetLink = `${appUrl}/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: `"badhon smm" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Reset your password",
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #10b981;">Password Reset Request</h2>
          <p>You requested to reset your password. Please click the button below to set a new password.</p>
          <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background-color: #10b981; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 10px;">Reset Password</a>
          <p style="margin-top: 20px; font-size: 12px; color: #666;">If you didn't request this, please ignore this email.</p>
          <p style="font-size: 12px; color: #666;">${resetLink}</p>
        </div>
      `,
    };

    try {
      if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: "Reset link sent to your email." });
      } else {
        console.log("Email credentials not set. Reset link:", resetLink);
        res.json({ success: true, message: "Reset link generated (check server logs)." });
      }
    } catch (err) {
      res.status(500).json({ error: "Failed to send email." });
    }
  });

  app.post("/api/auth/reset-password", (req, res) => {
    const { token, newPassword } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE verification_token = ?").get(token) as any;
    
    if (!user) {
      return res.status(400).json({ error: "Invalid or expired reset token." });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    db.prepare("UPDATE users SET password = ?, verification_token = NULL WHERE id = ?").run(hashedPassword, user.id);
    res.json({ success: true });
  });

  app.get("/api/admin/provider-balance", async (req, res) => {
    const apiKey = process.env.SMM_API_KEY;
    const apiUrl = process.env.SMM_API_URL || "https://justanotherpanel.com/api/v2";

    if (!apiKey || apiKey === "YOUR_API_KEY_HERE") {
      return res.json({ balance: "Not Configured", currency: "" });
    }

    try {
      const params = new URLSearchParams();
      params.append('key', apiKey);
      params.append('action', 'balance');

      const response = await fetch(apiUrl, {
        method: 'POST',
        body: params
      });
      const data = await response.json() as any;
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch provider balance" });
    }
  });

  // Service Routes
  app.get("/api/services", (req, res) => {
    const services = db.prepare("SELECT * FROM services").all();
    res.json(services);
  });

  // Order Routes
  app.post("/api/orders", async (req, res) => {
    const { userId, serviceId, link, quantity } = req.body;
    
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
    const service = db.prepare("SELECT * FROM services WHERE id = ?").get(serviceId) as any;

    if (!user || !service) return res.status(404).json({ error: "User or Service not found" });

    const charge = (service.rate * quantity) / 1000;
    
    if (user.balance < charge) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // Deduct balance
    db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(charge, userId);

    // --- EXTERNAL API INTEGRATION ---
    let providerOrderId = null;
    const apiKey = process.env.SMM_API_KEY;
    const apiUrl = process.env.SMM_API_URL || "https://justanotherpanel.com/api/v2";

    if (apiKey && apiKey !== "YOUR_API_KEY_HERE") {
      try {
        const params = new URLSearchParams();
        params.append('key', apiKey);
        params.append('action', 'add');
        params.append('service', service.id.toString()); // Note: In production, map your local ID to provider ID
        params.append('link', link);
        params.append('quantity', quantity.toString());

        const providerResponse = await fetch(apiUrl, {
          method: 'POST',
          body: params
        });
        
        const providerData = await providerResponse.json() as any;
        if (providerData.order) {
          providerOrderId = providerData.order;
          console.log(`Order placed on provider: ${providerOrderId}`);
        } else if (providerData.error) {
          console.error(`Provider API Error: ${providerData.error}`);
          // In a real app, you might want to refund the user if the provider fails
        }
      } catch (err) {
        console.error("Failed to connect to SMM Provider API", err);
      }
    }
    // --------------------------------

    // Create order
    const info = db.prepare("INSERT INTO orders (user_id, service_id, link, quantity, charge) VALUES (?, ?, ?, ?, ?)").run(userId, serviceId, link, quantity, charge);

    res.json({ success: true, orderId: info.lastInsertRowid, newBalance: user.balance - charge });
  });

  app.get("/api/orders/:userId", (req, res) => {
    const orders = db.prepare(`
      SELECT o.*, s.name as service_name 
      FROM orders o 
      JOIN services s ON o.service_id = s.id 
      WHERE o.user_id = ? 
      ORDER BY o.created_at DESC
    `).all(req.params.userId);
    res.json(orders);
  });

  app.get("/api/user/:userId", (req, res) => {
    const user = db.prepare("SELECT id, username, email, balance, is_admin FROM users WHERE id = ?").get(req.params.userId);
    res.json(user);
  });

  app.put("/api/user/:userId/profile", (req, res) => {
    const { username, password } = req.body;
    const userId = req.params.userId;
    try {
      if (password) {
        const hashedPassword = bcrypt.hashSync(password, 10);
        db.prepare("UPDATE users SET username = ?, password = ? WHERE id = ?").run(username, hashedPassword, userId);
      } else {
        db.prepare("UPDATE users SET username = ? WHERE id = ?").run(username, userId);
      }
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ error: "Username already exists" });
    }
  });

  app.post("/api/user/add-funds", (req, res) => {
    const { userId, method, amount, trxId } = req.body;
    try {
      db.prepare("INSERT INTO payment_requests (user_id, method, amount, trx_id) VALUES (?, ?, ?, ?)").run(userId, method, amount, trxId);
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ error: "Transaction ID already submitted" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
