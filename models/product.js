// models/product.js
const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true 
    },
    price: { 
        type: Number,
        required: true,
        min: 0
    },
    image: { 
        type: String, 
        default: '/images/placeholder.jpg' // Jab tak aap kids ki pics nahi dete, ye kaam aayega
    },
    category: { 
        type: String, 
        enum: ['men', 'women', 'kids'], // Kids category yahan add ho gayi hai
        required: true 
    },
    description: { 
        type: String 
    },
    stock: { type: Number, default: 100, min: 0 },
    createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);
