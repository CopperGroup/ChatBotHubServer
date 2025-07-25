import Transaction from "../models/transaction.js";
import User from "../models/user.js";

// Get all transactions for a specific user
export const getTransactions = async (req, res) => {
  try {
    if (req.user.id !== req.params.userId) {
      return res.status(403).json({ message: "Unauthorized: Access denied" });
    }

    const transactions = await Transaction.find({
      user: req.params.userId,
    }).sort({ date: -1 });
    res.status(200).json(transactions);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};

// Create a new transaction for a specific user
export const createTransaction = async (req, res) => {
  const { amount, name, status } = req.body;

  try {
    if (req.user.id !== req.params.userId) {
      return res.status(403).json({ message: "Unauthorized: Access denied" });
    }

    if (amount === undefined || !name) {
      return res
        .status(400)
        .json({ message: "Amount and name are required for a transaction" });
    }

    const newTransaction = new Transaction({
      user: req.params.userId,
      amount,
      name,
      status,
    });

    await newTransaction.save();

    await User.findByIdAndUpdate(req.params.userId, {
      $push: { transactions: newTransaction._id },
    });

    res.status(201).json({
      message: "Transaction created successfully",
      transaction: newTransaction,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
};
