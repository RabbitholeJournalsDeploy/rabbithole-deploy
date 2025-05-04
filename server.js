const express = require('express');
const fs = require('fs');
const nodemailer = require('nodemailer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
require('dotenv').config();
const frontendUrl = process.env.FRONTEND_URL;
const backendUrl = process.env.BACKEND_URL;


const app = express();
const corsOptions = {
  origin: frontendUrl,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
};

app.use(cors(corsOptions));

app.use(express.json());

const dataFilePath = './subscribers.json';
const pendingFilePath = './pendingSubscribers.json';
const PENDING_EXPIRATION_MINUTES = 30;

const postsFilePath = './posts.json';


if (!fs.existsSync(postsFilePath)) {
  fs.writeFileSync(postsFilePath, JSON.stringify([]));
}

// Inicializálás
if (!fs.existsSync(dataFilePath)) {
  fs.writeFileSync(dataFilePath, JSON.stringify([]));
}
if (!fs.existsSync(pendingFilePath)) {
  fs.writeFileSync(pendingFilePath, JSON.stringify({}));
}

// Törli a lejárt függőben lévő regisztrációkat
function cleanExpiredPending() {
  const pending = JSON.parse(fs.readFileSync(pendingFilePath));
  const now = new Date();
  let updated = false;

  for (const token in pending) {
    const timestamp = new Date(pending[token].timestamp);
    const minutesPassed = (now - timestamp) / 1000 / 60;

    if (minutesPassed > PENDING_EXPIRATION_MINUTES) {
      delete pending[token];
      updated = true;
    }
  }

  if (updated) {
    fs.writeFileSync(pendingFilePath, JSON.stringify(pending, null, 2));
  }
}

cleanExpiredPending();
setInterval(cleanExpiredPending, 5 * 60 * 1000);

// POST /send-email
app.post('/send-email', async (req, res) => {
  const { name, surname, email } = req.body;
  cleanExpiredPending();

  if (!email) return res.status(400).send('Email is required.');

  const subscribers = JSON.parse(fs.readFileSync(dataFilePath));
  const pending = JSON.parse(fs.readFileSync(pendingFilePath));

  if (subscribers.find(sub => sub.email === email) || Object.values(pending).find(sub => sub.email === email)) {
    return res.status(400).send('User is already subscribed or pending confirmation.');
  }

  const token = uuidv4();
  const firstName = name || email.split('@')[0];
  const lastName = surname || '';

  pending[token] = { firstName, lastName, email, timestamp: new Date().toISOString() };
  fs.writeFileSync(pendingFilePath, JSON.stringify(pending, null, 2));

  try {
    let transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const confirmationLink = `${backendUrl}/confirm/${token}`;
    
    await transporter.sendMail({
      from: `"RabbitHole" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Confirm your subscription",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Confirm your subscription 🐇</h2>
          <p>Hi <strong>${firstName}</strong>,</p>
          <p>Click the link below to confirm your subscription to RabbitHole Journals:</p>
          <p><a href="${confirmationLink}" style="color: #ff6c17;">Confirm Subscription</a></p>
          <p style="color: #888; font-size: 14px;">This link will expire in 30 minutes.</p>
          <p>If you didn't request this, just ignore this message.</p>
        </div>
      `,
    });

    res.status(200).send('Confirmation email sent.');
  } catch (error) {
    console.error('Error while sending confirmation email:', error);
    res.status(500).send('Error sending confirmation email.');
  }
});

// GET /confirm/:token
app.get('/confirm/:token', async (req, res) => {
  const { token } = req.params;
  const pending = JSON.parse(fs.readFileSync(pendingFilePath));

  if (!pending[token]) return res.status(400).send('Invalid or expired confirmation link.');

  const timestamp = new Date(pending[token].timestamp);
  const now = new Date();
  const minutesPassed = (now - timestamp) / 1000 / 60;

  if (minutesPassed > PENDING_EXPIRATION_MINUTES) {
    delete pending[token];
    fs.writeFileSync(pendingFilePath, JSON.stringify(pending, null, 2));
    return res.status(400).send('This confirmation link has expired.');
  }

  const subscribers = JSON.parse(fs.readFileSync(dataFilePath));
  const newSubscriber = { ...pending[token], unsubscribeToken: uuidv4() };

  subscribers.push(newSubscriber);
  fs.writeFileSync(dataFilePath, JSON.stringify(subscribers, null, 2));
  delete pending[token];
  fs.writeFileSync(pendingFilePath, JSON.stringify(pending, null, 2));

  try {
    let transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"RabbitHole" <${process.env.EMAIL_USER}>`,
      to: newSubscriber.email,
      subject: "Welcome to RabbitHole 🐇",
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #f5f5f5; padding: 30px;">
          <div style="max-width: 600px; margin: auto; background: white; border-radius: 10px; padding: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
            <h2 style="color: #ff6c17; text-align: center;">Welcome to RabbitHole 🐇</h2>
            <p style="font-size: 16px; color: #333;">
              Hi <strong>${newSubscriber.firstName} ${newSubscriber.lastName}</strong>,
            </p>
            <p style="font-size: 16px; color: #333;">
              Thanks a lot for subscribing to RabbitHole! We’re thrilled to have you in the warren.
            </p>
            <p style="font-size: 16px; color: #333;">
              We’ll keep you posted with updates, surprises, and exciting things from deep down the hole. 🔍✨
            </p>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
            <p style="font-size: 14px; color: #777; text-align: center;">
              If you ever want to hop out...<br>
              <a href="${frontendUrl}/unsubscribe?token=${newSubscriber.unsubscribeToken}" style="color: #ff6c17; font-weight: bold;">Unsubscribe</a>
            </p>
          </div>
        </div>
      `,
    });

    res.send(`
      <h1 style="font-family: sans-serif; color: #4caf50;">Subscription confirmed!</h1>
      <p>Thanks for subscribing to RabbitHole 🐇. We'll keep you posted!</p>
    `);
  } catch (error) {
    console.error('Error while sending welcome email:', error);
    res.status(500).send('Error sending welcome email.');
  }
});

// Admin login védelem
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_TIME_MS = 5 * 60 * 1000;

app.post('/admin-login', (req, res) => {
  const { username, password } = req.body;
  const ip = req.ip;
  const attempt = loginAttempts.get(ip) || { count: 0, lockedUntil: null };

  if (attempt.lockedUntil && Date.now() < attempt.lockedUntil) {
    const remaining = Math.ceil((attempt.lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ success: false, message: `Too many attempts. Try again in ${remaining} seconds.` });
  }

  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    loginAttempts.delete(ip);
    return res.status(200).json({ success: true, token: "secret-admin-token" });
  } else {
    attempt.count += 1;
    if (attempt.count >= MAX_ATTEMPTS) {
      attempt.lockedUntil = Date.now() + LOCKOUT_TIME_MS;
      attempt.count = 0;
    }
    loginAttempts.set(ip, attempt);
    return res.status(401).json({ success: false, message: "Incorrect username or password." });
  }
});

// GET /get-subscribers
app.get('/get-subscribers', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 10;

  try {
    const allSubscribers = JSON.parse(fs.readFileSync(dataFilePath));
    const total = allSubscribers.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const paginated = allSubscribers.slice(startIndex, startIndex + limit);

    res.json({ page, totalPages, totalSubscribers: total, subscribers: paginated });
  } catch (err) {
    console.error('Error reading subscribers file:', err);
    res.status(500).json({ message: 'Failed to read subscriber data.' });
  }
});

// DELETE /unsubscribe
app.delete('/unsubscribe', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).send('Token is required.');

  const subscribers = JSON.parse(fs.readFileSync(dataFilePath));
  const index = subscribers.findIndex(sub => sub.unsubscribeToken === token);

  if (index === -1) return res.status(404).send('Subscriber not found.');

  subscribers.splice(index, 1);
  fs.writeFileSync(dataFilePath, JSON.stringify(subscribers, null, 2));
  res.send('You have been unsubscribed successfully.');
});

// A verify-unsubscribe végpont, amely a token ellenőrzését végzi
app.get('/verify-unsubscribe', (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ success: false, message: 'Token is required.' });
  }

  const pending = JSON.parse(fs.readFileSync(pendingFilePath));

  // Ha nem találunk ilyen tokent
  if (!pending[token]) {
    return res.status(404).json({ success: false, message: 'Invalid or expired token.' });
  }

  // Ha sikerült, válaszolunk a megfelelő információval
  const subscriber = pending[token];
  res.status(200).json({
    success: true,
    email: subscriber.email
  });
});

app.post('/add-post', async (req, res) => {
  const { title, content } = req.body;

  if (!title || !content) {
    return res.status(400).json({ message: 'Title and content are required.' });
  }

  const posts = JSON.parse(fs.readFileSync(postsFilePath));
  const newPost = {
    id: uuidv4(),
    title,
    content,
    timestamp: new Date().toISOString()
  };

  posts.push(newPost);
  fs.writeFileSync(postsFilePath, JSON.stringify(posts, null, 2));

  // Email notification to subscribers
  const subscribers = JSON.parse(fs.readFileSync(dataFilePath));
  if (subscribers.length > 0) {
    try {
      let transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      const emailPromises = subscribers.map(subscriber =>
        transporter.sendMail({
          from: `"RabbitHole" <${process.env.EMAIL_USER}>`,
          to: subscriber.email,
          subject: `New Post: ${title}`,
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px;">
              <h2 style="color: #ff6c17;">🐇 New Post: ${title}</h2>
              <p>${content.substring(0, 200)}...</p>
              <p><a href="${frontendUrl}/posts" style="color: #ff6c17;">Read more on RabbitHole</a></p>
              <p style="font-size: 14px; color: #777;">You received this email because you subscribed to RabbitHole Journals.</p>
            </div>
          `,
        })
      );

      await Promise.all(emailPromises);
    } catch (error) {
      console.error('Failed to send post email:', error);
    }
  }

  res.status(201).json({ message: 'Post added and notification sent.', post: newPost });
});



app.get('/get-posts', (req, res) => {
  const posts = JSON.parse(fs.readFileSync(postsFilePath));
  res.json(posts);
});

// GET /get-post/:id
app.get('/get-post/:id', (req, res) => {
  const postId = req.params.id;
  const posts = JSON.parse(fs.readFileSync(postsFilePath));

  const post = posts.find(p => p.id === postId);

  if (!post) {
    return res.status(404).json({ message: 'Post not found' });
  }

  res.json(post);
});

// Serve frontend build
app.use(express.static(path.join(__dirname, 'build')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
