const mongoose = require('mongoose');
const Product = require('../models/product');

const products = [];
const men = ['blue', 'black', 'gray', 'brown', 'green', 'naviblue', 'orange', 'pink', 'red', 'yellow'];
men.forEach((color, index) => products.push({ name: `${color[0].toUpperCase()}${color.slice(1)} Men's Denim`, price: 1000 + index * 100, image: `/menimages/${color}.jpg`, category: 'men', stock: 20 }));
for (let i = 1; i <= 20; i++) products.push({ name: `Women's Denim Style ${i}`, price: 2000 + i * 150, image: `/womenimages/${i}.jpg`, category: 'women', stock: 20 });
for (let i = 1; i <= 16; i++) products.push({ name: `Kids' Denim Style ${i}`, price: 1500 + i * 100, image: `/kidsimages/${i}.jpg`, category: 'kids', stock: 20 });

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/jeansStore')
  .then(async () => {
    await Product.deleteMany({});
    await Product.insertMany(products);
    console.log(`Seeded ${products.length} products.`);
    await mongoose.disconnect();
  })
  .catch(async error => { console.error(error); await mongoose.disconnect(); process.exit(1); });
