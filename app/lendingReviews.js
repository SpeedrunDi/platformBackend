const express = require('express')
const path = require('path')
const { nanoid } = require('nanoid')
const { config } = require('dotenv')
const multer = require('multer')
const permit = require('../middleweare/permit')
const auth = require('../middleweare/auth')
const Review = require('../models/LendingReview')

const router = express.Router()

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.uploadPath)
  },
  filename: (req, file, cb) => {
    cb(null, nanoid() + path.extname(file.originalname))
  },
})

const upload = multer({ storage })

router.get('/', async (req, res) => {
  try {
    const review = await Review.find()
    return res.send(review)
  } catch (e) {
    return res.status(500).send({ error: e.message })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const findReview = await Review.findById(req.params.id)

    if (!findReview) {
      return res.status(404).send({ message: 'Review not found!' })
    }

    return res.send(findReview)
  } catch (e) {
    return res.status(500).send({ error: e.message })
  }
})

router.post('/', auth, permit('admin'), upload.single('image'), async (req, res) => {
  try {
    const { name, socialNetwork, description } = req.body
    if (!name || !socialNetwork || !description) {
      return res.status(400).send({
        message: 'Data not valid',
      })
    }

    const reviewData = {
      name,
      description,
      socialNetwork,
      image: null,
    }
    if (req.file) {
      reviewData.image = req.file.filename
    }

    const review = new Review(reviewData)
    await review.save()
    return res.send(review)
  } catch (e) {
    console.log(e)
    return res.status(500).send({ error: e.message })
  }
})

router.put('/:id', auth, permit('admin'), async (req, res) => {
  try {
    const { text, socialNetwork } = req.body

    if (!text || !socialNetwork) {
      return res.status(400).send({ error: 'Data not valid' })
    }

    const reviewData = {
      text,
      user: req.user._id,
      socialNetwork,
    }

    const review = await Review.findById(req.params.id)

    if (!review) {
      return res.status(404).send({ message: 'Review not found!' })
    }

    const updateReview = await Review.findByIdAndUpdate(req.params.id, reviewData, { new: true })
    return res.send(updateReview)
  } catch (e) {
    return res.status(500).send({ error: e.message })
  }
})

router.delete('/:id', auth, permit('admin'), async (req, res) => {
  try {
    const review = await Review.findById(req.params.id)

    if (!review) {
      return res.status(404).send({ message: 'Review not found!' })
    }

    const deleteReview = await Review.findByIdAndDelete({ _id: req.params.id })

    return res.send(deleteReview)
  } catch (e) {
    return res.status(500).send({ error: e.message })
  }
})

module.exports = router