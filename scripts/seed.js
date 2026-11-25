const dns = require('node:dns');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Product = require('../models/product');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const entry = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (entry && process.env[entry[1]] === undefined) {
      process.env[entry[1]] = entry[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/jeansStore';
if (mongoUri.startsWith('mongodb+srv://') && process.env.MONGODB_DNS_SERVERS) {
  dns.setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(server => server.trim()).filter(Boolean));
}

const products = [];
const men = ['blue', 'black', 'gray', 'brown', 'green', 'naviblue', 'orange', 'pink', 'red', 'yellow'];
men.forEach((color, index) => products.push({ name: `${color[0].toUpperCase()}${color.slice(1)} Men's Denim`, price: 1000 + index * 100, image: `/menimages/${color}.jpg`, category: 'men', stock: 20 }));
for (let i = 1; i <= 20; i++) products.push({ name: `Women's Denim Style ${i}`, price: 2000 + i * 150, image: `/womenimages/${i}.jpg`, category: 'women', stock: 20 });
for (let i = 1; i <= 16; i++) products.push({ name: `Kids' Denim Style ${i}`, price: 1500 + i * 100, image: `/kidsimages/${i}.jpg`, category: 'kids', stock: 20 });

async function seed() {
  try {
    await mongoose.connect(mongoUri);
    const result = await Product.bulkWrite(products.map(product => ({
      updateOne: {
        filter: { name: product.name, category: product.category },
        update: { $setOnInsert: product },
        upsert: true
      }
    })), { ordered: false });
    console.log(`Seed complete: ${result.upsertedCount} new products added; existing products kept in database "${mongoose.connection.name}".`);
  } finally {
    await mongoose.disconnect();
  }
}

seed().catch(error => {
  console.error('Product seeding failed:', error.message);
  process.exitCode = 1;
});
