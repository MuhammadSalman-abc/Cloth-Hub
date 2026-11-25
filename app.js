const express = require('express');
const dns = require('node:dns');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const entry = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (entry && process.env[entry[1]] === undefined) process.env[entry[1]] = entry[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const User = require('./models/User');
const Product = require('./models/product');
const Cart = require('./models/Cart');
const Order = require('./models/Order');
const LocalSessionStore = require('./models/LocalSessionStore');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/jeansStore';
if (MONGODB_URI.startsWith('mongodb+srv://') && process.env.MONGODB_DNS_SERVERS) {
  dns.setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(server => server.trim()).filter(Boolean));
}
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const stripe = STRIPE_SECRET_KEY ? require('stripe')(STRIPE_SECRET_KEY) : null;
const STORE_WHATSAPP_NUMBER = String(process.env.STORE_WHATSAPP_NUMBER || '').replace(/\D/g, '');
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const allowedSizes = new Set(['30', '32', '34', '36']);
const allowedColors = new Set(['Default', 'Blue', 'Black']);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(session({
  secret: SESSION_SECRET || 'local-development-only-change-this-secret',
  store: new LocalSessionStore(path.join(__dirname, '.sessions.json')),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use((req, res, next) => {
  res.locals.notice = req.session.notice || null;
  delete req.session.notice;
  next();
});

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/admin/login');
  if (!ADMIN_EMAIL || String(req.session.user?.email || '').toLowerCase() !== ADMIN_EMAIL) {
    return res.redirect('/admin/login');
  }
  User.findById(req.session.user._id).select('role').then(user => {
    if (!user || user.role !== 'admin') return res.status(403).render('error', { message: 'This account does not have the admin role yet.' });
    next();
  }).catch(next);
}

function setNotice(req, message) { req.session.notice = message; }
function productSalePrice(product) { return Math.round(product.price * 0.8 * 100) / 100; }

async function renderCatalog(req, res, query, title) {
  const { q = '', sort = 'newest' } = req.query;
  const filter = { ...query };
  if (q.trim()) filter.name = { $regex: q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const sortOptions = { newest: { createdAt: -1 }, 'price-asc': { price: 1 }, 'price-desc': { price: -1 }, name: { name: 1 } };
  const limit = 12;
  const [jeans, total] = await Promise.all([
    Product.find(filter).sort(sortOptions[sort] || sortOptions.newest).limit(limit),
    Product.countDocuments(filter)
  ]);
  res.render('index', {
    user: req.session.user,
    jeans,
    title,
    category: query.category || '',
    q,
    sort,
    hasMore: total > jeans.length,
    isAdmin: Boolean(ADMIN_EMAIL && req.session.user.email.toLowerCase() === ADMIN_EMAIL),
    notice: req.query.orderPlaced === '1'
      ? 'Thank you! Your order has been confirmed. Explore more styles.'
      : res.locals.notice
  });
}

app.get('/', requireLogin, async (req, res, next) => { try { await renderCatalog(req, res, {}, 'All Products'); } catch (e) { next(e); } });
for (const [route, category, title] of [['men', 'men', 'Men Collection'], ['women', 'women', 'Women Collection'], ['kids', 'kids', 'Kids Collection']]) {
  app.get(`/${route}`, requireLogin, async (req, res, next) => { try { await renderCatalog(req, res, { category }, title); } catch (e) { next(e); } });
}

app.get('/about', requireLogin, (req, res) => res.render('about', { user: req.session.user }));
app.get('/contact', requireLogin, (req, res) => res.render('contact', { user: req.session.user, whatsappNumber: STORE_WHATSAPP_NUMBER }));

app.get('/api/products', requireLogin, async (req, res, next) => {
  try {
    const category = String(req.query.category || '');
    const q = String(req.query.q || '').trim().slice(0, 100);
    const sort = String(req.query.sort || 'newest');
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 12;
    if (category && !['men', 'women', 'kids'].includes(category)) return res.status(400).json({ error: 'Invalid category.' });
    const sortOptions = { newest: { createdAt: -1 }, 'price-asc': { price: 1 }, 'price-desc': { price: -1 }, name: { name: 1 } };
    const filter = {};
    if (category) filter.category = category;
    if (q) filter.name = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const [jeans, total] = await Promise.all([
      Product.find(filter).sort(sortOptions[sort] || sortOptions.newest).skip((page - 1) * limit).limit(limit),
      Product.countDocuments(filter)
    ]);
    res.render('product-cards', { jeans }, (err, html) => {
      if (err) return next(err);
      res.json({ html, hasMore: page * limit < total });
    });
  } catch (e) { next(e); }
});

app.get('/products/:id', requireLogin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).render('error', { message: 'Product not found.' });
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).render('error', { message: 'Product not found.' });
    res.render('product', { user: req.session.user, product, salePrice: productSalePrice(product) });
  } catch (e) { next(e); }
});

// Catalog seeding is a local CLI operation so a public request cannot erase products.
app.get('/seed', (req, res) => res.status(404).send('Not found'));

app.get('/register', (req, res) => res.render('register'));
app.post('/register', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (name.length < 2 || name.length > 80 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || password.length > 128) {
      return res.status(400).render('register', { error: 'Name, valid email, aur 8–128 character password dein.' });
    }
    const user = await User.create({ name, email, password: await bcrypt.hash(password, 12) });
    req.session.user = { _id: user._id, name: user.name, email: user.email, role: user.role };
    res.redirect('/');
  } catch (e) {
    if (e.code === 11000) return res.status(409).render('register', { error: 'Is email ka account pehle se maujood hai.' });
    next(e);
  }
});
app.get('/login', (req, res) => res.render('login', { resetComplete: req.query.reset === '1' }));
app.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.password))) {
      return res.status(401).render('login', { error: 'Email ya password sahi nahi hai.' });
    }
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.user = { _id: user._id, name: user.name, email: user.email, role: user.role };
      res.redirect('/');
    });
  } catch (e) { next(e); }
});
app.get('/forgot-password', (req, res) => res.render('forgot-password', { submitted: false, resetLink: null, message: null }));
app.post('/forgot-password', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    let resetLink = null;
    const user = email ? await User.findOne({ email }) : null;
    const remoteAddress = String(req.socket.remoteAddress || req.ip || '');
    const isLocalRequest = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress);
    if (user && isLocalRequest && process.env.NODE_ENV !== 'production') {
      const token = crypto.randomBytes(32).toString('hex');
      user.passwordResetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
      user.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000);
      await user.save();
      resetLink = `${process.env.APP_URL || `${req.protocol}://${req.get('host')}`}/reset-password?token=${token}`;
    }
    res.render('forgot-password', {
      submitted: true,
      resetLink,
      message: isLocalRequest && !user
        ? 'Is email se koi account nahi mila. Registration wala exact email check karein.'
        : isLocalRequest
          ? 'Agar account is email se hai, local reset link neeche hai. Link 15 minutes mein expire hoga.'
        : 'If the account exists, ask the store owner to open the reset link on the local machine.'
    });
  } catch (e) { next(e); }
});
app.get('/reset-password', async (req, res, next) => {
  try {
    const token = String(req.query.token || '');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = token.length === 64 ? await User.findOne({ passwordResetTokenHash: tokenHash, passwordResetExpires: { $gt: new Date() } }).select('+passwordResetTokenHash +passwordResetExpires') : null;
    if (!user) return res.status(400).render('reset-password', { token: '', error: 'This reset link is invalid or expired. Request a new one.' });
    res.render('reset-password', { token, error: null });
  } catch (e) { next(e); }
});
app.post('/reset-password', async (req, res, next) => {
  try {
    const token = String(req.body.token || '');
    const password = String(req.body.password || '');
    if (password.length < 8 || password.length > 128) return res.status(400).render('reset-password', { token, error: 'Password 8 se 128 characters ka hona chahiye.' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = token.length === 64 ? await User.findOne({ passwordResetTokenHash: tokenHash, passwordResetExpires: { $gt: new Date() } }).select('+passwordResetTokenHash +passwordResetExpires') : null;
    if (!user) return res.status(400).render('reset-password', { token: '', error: 'This reset link is invalid or expired. Request a new one.' });
    user.password = await bcrypt.hash(password, 12);
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpires = undefined;
    await user.save();
    res.redirect('/login?reset=1');
  } catch (e) { next(e); }
});
app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

app.get('/admin/login', (req, res) => res.render('admin-login', { error: null }));
app.post('/admin/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await User.findOne({ email });
    if (!ADMIN_EMAIL || email !== ADMIN_EMAIL || !user || user.role !== 'admin' || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).render('admin-login', { error: 'Admin email ya password sahi nahi hai.' });
    }
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.user = { _id: user._id, name: user.name, email: user.email, role: user.role };
      res.redirect('/admin');
    });
  } catch (e) { next(e); }
});

app.post('/add-to-cart', requireLogin, async (req, res, next) => {
  try {
    const { productId } = req.body;
    const size = String(req.body.size || '');
    const color = String(req.body.color || 'Default');
    const quantity = Math.max(1, Math.min(10, parseInt(req.body.quantity, 10) || 1));
    if (!mongoose.isValidObjectId(productId) || !allowedSizes.has(size) || !allowedColors.has(color)) {
      setNotice(req, 'Product options valid nahi hain. Dobara select karein.');
      return res.redirect('/');
    }
    const product = await Product.findById(productId);
    if (!product) { setNotice(req, 'Yeh product ab available nahi hai.'); return res.redirect('/'); }
    let cart = await Cart.findOne({ userId: req.session.user._id });
    if (!cart) cart = new Cart({ userId: req.session.user._id, items: [] });
    const existing = cart.items.find(item => String(item.productId) === String(product._id) && item.size === size && item.color === color);
    if (existing) existing.quantity = Math.min(10, existing.quantity + quantity);
    else cart.items.push({ productId: product._id, name: product.name, image: product.image, price: productSalePrice(product), size, color, quantity });
    await cart.save();
    setNotice(req, 'Product cart mein add ho gaya.');
    res.redirect('/cart');
  } catch (e) { next(e); }
});

app.get('/cart', requireLogin, async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ userId: req.session.user._id });
    if (cart) {
      const seen = new Map();
      for (const item of [...cart.items]) {
        const key = `${item.name.trim().toLowerCase()}:${item.size}:${item.color}`;
        const previous = seen.get(key);
        if (previous) {
          previous.quantity = Math.min(10, previous.quantity + (item.quantity || 1));
          cart.items.pull(item._id);
        } else {
          seen.set(key, item);
        }
        const product = await Product.findById(item.productId).select('image price');
        item.image = (product && product.image) || item.image || '/images/background.jpg';
        if (product) item.price = productSalePrice(product);
      }
      if (cart.isModified()) await cart.save();
    }
    res.render('cart', {
      user: req.session.user,
      cart,
      notice: res.locals.notice || null,
      total: cart ? cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0) : 0
    });
  } catch (e) { next(e); }
});

app.post('/cart/update/:itemId', requireLogin, async (req, res, next) => {
  try {
    const quantity = parseInt(req.body.quantity, 10);
    const cart = await Cart.findOne({ userId: req.session.user._id });
    const item = cart && cart.items.id(req.params.itemId);
    if (!item) { setNotice(req, 'Cart item nahi mila.'); return res.redirect('/cart'); }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) { setNotice(req, 'Quantity 1 se 10 ke darmiyan honi chahiye.'); return res.redirect('/cart'); }
    item.quantity = quantity;
    await cart.save();
    res.redirect('/cart');
  } catch (e) { next(e); }
});
app.post('/cart/remove/:itemId', requireLogin, async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ userId: req.session.user._id });
    if (cart) { cart.items.pull(req.params.itemId); await cart.save(); }
    res.redirect('/cart');
  } catch (e) { next(e); }
});

app.get('/checkout', requireLogin, async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ userId: req.session.user._id });
    if (!cart || !cart.items.length) return res.redirect('/cart');
    res.render('checkout', {
      user: req.session.user,
      cart,
      total: cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0),
      storeWhatsApp: STORE_WHATSAPP_NUMBER,
      notice: res.locals.notice || null
    });
  } catch (e) { next(e); }
});

app.post('/place-order', requireLogin, async (req, res, next) => {
  try {
    const phone = String(req.body.phone || '').trim();
    const address = String(req.body.address || '').trim();
    const city = String(req.body.city || '').trim();
    const notes = String(req.body.notes || '').trim().slice(0, 500);
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 10 || phoneDigits.length > 15 || address.length < 8 || address.length > 300 || city.length < 2 || city.length > 80) {
      setNotice(req, 'Valid phone, complete address aur city enter karein.');
      return res.redirect('/checkout');
    }
    const cart = await Cart.findOne({ userId: req.session.user._id });
    if (!cart || !cart.items.length) return res.redirect('/cart');
    const orderItems = [];
    for (const item of cart.items) {
      const product = await Product.findById(item.productId);
      if (!product) { setNotice(req, `${item.name} ab available nahi hai.`); return res.redirect('/cart'); }
      if (product.stock < item.quantity) { setNotice(req, `${product.name} ka stock ab sirf ${product.stock} hai.`); return res.redirect('/cart'); }
      orderItems.push({ productId: product._id, name: product.name, image: product.image, price: productSalePrice(product), size: item.size, color: item.color, quantity: item.quantity });
    }
    const total = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const order = await Order.create({
      userId: req.session.user._id,
      items: orderItems,
      total,
      currency: 'pkr',
      paymentMethod: 'cash_on_delivery',
      status: 'pending',
      shipping: { phone, address, city, notes }
    });
    await Cart.findOneAndDelete({ userId: req.session.user._id });
    res.redirect(`/orders/${order._id}?placed=1`);
  } catch (e) { next(e); }
});

app.post('/create-checkout-session', requireLogin, async (req, res, next) => {
  try {
    if (!stripe) { setNotice(req, 'Stripe setup nahi hai. STRIPE_SECRET_KEY configure karein.'); return res.redirect('/checkout'); }
    const cart = await Cart.findOne({ userId: req.session.user._id });
    if (!cart || !cart.items.length) return res.redirect('/cart');
    const refreshedItems = [];
    for (const item of cart.items) {
      const product = await Product.findById(item.productId);
      if (!product) { setNotice(req, `${item.name} ab available nahi hai.`); return res.redirect('/cart'); }
      if (product.stock < item.quantity) { setNotice(req, `${product.name} ka stock ab sirf ${product.stock} hai.`); return res.redirect('/cart'); }
      refreshedItems.push({ item, product, price: productSalePrice(product) });
    }
    const origin = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const order = await Order.create({
      userId: req.session.user._id,
      items: refreshedItems.map(({ item, product, price }) => ({ productId: product._id, name: product.name, image: product.image, price, size: item.size, color: item.color, quantity: item.quantity })),
      total: refreshedItems.reduce((sum, row) => sum + row.price * row.item.quantity, 0),
      currency: 'pkr', status: 'pending'
    });
    const line_items = refreshedItems.map(({ item, product, price }) => ({
      price_data: { currency: 'pkr', product_data: { name: `${product.name} (Size ${item.size}, ${item.color})` }, unit_amount: Math.round(price * 100) },
      quantity: item.quantity
    }));
    const sessionObject = await stripe.checkout.sessions.create({
      payment_method_types: ['card'], line_items, mode: 'payment', client_reference_id: String(order._id),
      metadata: { orderId: String(order._id), userId: String(req.session.user._id) },
      success_url: `${origin}/orders/${order._id}?paid=1`, cancel_url: `${origin}/checkout?cancelled=1`
    });
    order.stripeSessionId = sessionObject.id;
    await order.save();
    res.redirect(303, sessionObject.url);
  } catch (e) { next(e); }
});

app.get('/stripe/webhook', (req, res) => res.status(405).send('POST required'));
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).send('Webhook is not configured');
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET); }
  catch (e) { return res.status(400).send(`Webhook signature verification failed: ${e.message}`); }
  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const stripeSession = event.data.object;
      const order = await Order.findOne({ _id: stripeSession.metadata.orderId, stripeSessionId: stripeSession.id });
      if (order && order.status !== 'paid') {
        for (const item of order.items) {
          const update = await Product.updateOne({ _id: item.productId, stock: { $gte: item.quantity } }, { $inc: { stock: -item.quantity } });
          if (!update.modifiedCount) {
            console.error(`Insufficient stock for paid order ${order._id}, product ${item.productId}`);
            order.status = 'failed';
            await order.save();
            return res.status(409).send('Payment received but inventory needs review');
          }
        }
        order.status = 'paid'; order.paidAt = new Date(); order.paymentIntentId = stripeSession.payment_intent;
        await order.save();
        await Cart.findOneAndDelete({ userId: order.userId });
      }
    } else if (event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
      const stripeSession = event.data.object;
      await Order.findOneAndUpdate({ stripeSessionId: stripeSession.id, status: 'pending' }, { status: 'failed' });
    }
    res.json({ received: true });
  } catch (e) { console.error('Stripe webhook processing error:', e.message); res.status(500).send('Webhook processing failed'); }
});

app.get('/orders', requireLogin, async (req, res, next) => {
  try { const orders = await Order.find({ userId: req.session.user._id }).sort({ createdAt: -1 }); res.render('orders', { user: req.session.user, orders }); }
  catch (e) { next(e); }
});
app.get('/orders/:id', requireLogin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).render('error', { message: 'Order not found.' });
    const order = await Order.findOne({ _id: req.params.id, userId: req.session.user._id });
    if (!order) return res.status(404).render('error', { message: 'Order not found.' });
    res.render('order', { user: req.session.user, order, checkingPayment: req.query.paid === '1', placed: req.query.placed === '1' });
  } catch (e) { next(e); }
});

app.get('/admin', requireAdmin, async (req, res, next) => {
  try {
    if (!req.session.adminCsrfToken) req.session.adminCsrfToken = crypto.randomBytes(32).toString('hex');
    const [orders, totalOrders, openOrders, totalProducts] = await Promise.all([
      Order.find().populate('userId', 'name email').sort({ createdAt: -1 }).limit(300).lean(),
      Order.countDocuments(),
      Order.countDocuments({ status: { $in: ['pending', 'confirmed', 'shipped'] } }),
      Product.countDocuments()
    ]);
    res.render('admin', { user: req.session.user, orders, totalOrders, openOrders, totalProducts, csrfToken: req.session.adminCsrfToken, notice: res.locals.notice || null });
  } catch (e) { next(e); }
});

app.post('/admin/orders/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const statuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'paid', 'failed'];
    const status = String(req.body.status || '');
    const suppliedToken = String(req.body.csrfToken || '');
    const expectedToken = String(req.session.adminCsrfToken || '');
    if (!expectedToken || suppliedToken.length !== expectedToken.length || !crypto.timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(expectedToken))) {
      return res.status(403).render('error', { message: 'Admin form expired. Refresh the admin page and try again.' });
    }
    if (!mongoose.isValidObjectId(req.params.id) || !statuses.includes(status)) {
      setNotice(req, 'Order ya status valid nahi hai.');
      return res.redirect('/admin');
    }
    const result = await Order.updateOne({ _id: req.params.id }, { $set: { status } });
    setNotice(req, result.matchedCount ? 'Order status update ho gaya.' : 'Order nahi mila.');
    res.redirect('/admin');
  } catch (e) { next(e); }
});

app.use((req, res) => res.status(404).render('error', { message: 'Page not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render('error', { message: process.env.NODE_ENV === 'production' ? 'Something went wrong. Please try again.' : err.message });
});

mongoose.connect(MONGODB_URI).then(() => {
  app.listen(PORT, () => console.log(`Server started on http://localhost:${PORT}`));
}).catch(err => {
  console.error('MongoDB connection failed:', err.message);
  process.exit(1);
});
