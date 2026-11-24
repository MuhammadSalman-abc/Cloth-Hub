const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  name: { type: String, required: true },
  image: String,
  price: { type: Number, required: true, min: 0 },
  size: { type: String, required: true },
  color: { type: String, default: 'Default' },
  quantity: { type: Number, required: true, min: 1 }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  items: { type: [orderItemSchema], required: true },
  total: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'pkr' },
  paymentMethod: { type: String, enum: ['stripe', 'cash_on_delivery'], default: 'cash_on_delivery' },
  shipping: {
    phone: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    notes: { type: String, default: '' }
  },
  status: { type: String, enum: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'paid', 'failed'], default: 'pending', index: true },
  stripeSessionId: { type: String, sparse: true, unique: true },
  paymentIntentId: String,
  paidAt: Date
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
