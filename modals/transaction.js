const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  vendorName: { type: String, default: 'Unknown' },
  date: { type: String, default: () => new Date().toISOString().split('T')[0] },
  totalAmount: { type: Number, required: true },
  category: { type: String, default: 'Other' },
  imagePath: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', transactionSchema);