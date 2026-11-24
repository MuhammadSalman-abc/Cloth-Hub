const mongoose = require('mongoose');

const cartSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: [
        {
            productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
            name: { type: String, required: true },
            image: String,
            price: { type: Number, required: true, min: 0 },
            size: { type: String, required: true },
            color: { type: String, default: 'Default' },
            quantity: { type: Number, default: 1, min: 1, max: 10 }
        }
    ]
});

cartSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model('Cart', cartSchema);    
