const express = require('express')
const axios = require('axios')
const { nanoid } = require('nanoid')
const { VKAPI } = require('vkontakte-api')
const { OAuth2Client } = require('google-auth-library')
const validator = require('email-validator')
const crypto = require('crypto')

const router = express.Router()
const client = new OAuth2Client()
const utils = require('../middleweare/token')
const nodemailer = require('./nodemailer')
const auth = require('../middleweare/auth')
const permit = require('../middleweare/permit')
const upload = require('../middleweare/upload')
const User = require('../models/User')
const Course = require('../models/Course')
const Test = require('../models/Test')
const Lesson = require('../models/Lesson')
const Task = require('../models/Task')
const Module = require('../models/Module')
const config = require('../config')

const getLiveCookie = user => {
  const { username } = user
  const maxAge = 730 * 60 * 60
  return { token: utils.getToken(username, maxAge), maxAge }
}

const getLiveSecretCookie = user => {
  const { username } = user
  const maxAge = 5 * 60 * 60
  return { token: utils.getToken(username, maxAge), maxAge }
}

router.get('/', auth, async (req, res) => {
  try {
    const query = { role: { $in: ['ban', 'user'] }, authentication: true }

    if (req.query.email) query.email = req.query.email

    const users = await User.find(query, { name: 1, email: 1, _id: 1, role: 1, username: 1 })

    return res.send(users)
  } catch {
    return res.status(500)
  }
})

router.get('/confirm/:confirmationCode', async (req, res) => {
  try {
    const user = await User.findOne({ confirmationCode: req.params.confirmationCode })
    if (!user) {
      return res.status(404).send({ message: 'User not found' })
    }
    user.authentication = true
    await user.save({ validateBeforeSave: false })
    return res.send({ message: 'Account confirm' })
  } catch (e) {
    return res.status(500).send({ message: e })
  }
})

router.post('/', async (req, res) => {
  try {
    const secretToken = getLiveSecretCookie({ email: req.body.email })
    const { email, password, username } = req.body

    const userData = { email, password, username, confirmationCode: secretToken.token }

    const user = new User(userData)

    const { token, maxAge } = getLiveCookie(user)

    res.cookie('jwt', token, {
      httpOnly: false,
      maxAge: maxAge * 1000,
    })

    user.token = token

    await user.save()

    nodemailer.sendConfirmationCode(user.username, user.email, user.confirmationCode)

    return res.status(201).send(user)
  } catch (e) {
    return res.status(400).send(e)
  }
})

router.post('/sessions', async (req, res) => {
  try {
    if (req.cookies.jwt) {
      const user = await User.findOne({ token: req.cookies.jwt })
      return res.send(user)
    }

    if (req.query.path === 'login') {
      if (!req.body.email || !req.body.password) {
        return res.status(401).send({ message: 'Введенные данные не верны!' })
      }

      const user = await User.findOne({ email: req.body.email })

      if (!user) {
        return res.status(401).send({ message: 'Введенные данные не верны!' })
      }

      if (user.authentication !== true) {
        return res.status(401).send({ message: 'Пожалуйста, подтвердите свою регистрацию на почте!' })
      }

      const isMatch = await user.checkPassword(req.body.password)
      if (!isMatch) {
        return res.status(401).send({ message: 'Введенные данные не верны!' })
      }

      const { token, maxAge } = getLiveCookie(user)

      res.cookie('jwt', token, {
        httpOnly: false,
        maxAge: maxAge * 1000,
      })

      user.token = token
      await user.save({ validateBeforeSave: false })

      return res.send(user)
    }

    if (req.query.path === 'facebookLogin') {
      const inputToken = req.body.accessToken
      const accessToken = `${config.facebook.appId}|${config.facebook.appSecret}`

      const debugTokenUrl = `https://graph.facebook.com/debug_token?input_token=${inputToken}&access_token=${accessToken}`

      const response = await axios.get(debugTokenUrl)

      if (response.data.data.error) {
        return res.status(401).send({ message: 'Facebook token incorrect!' })
      }

      if (req.body.userID !== response.data.data.user_id) {
        return res.status(401).send({ message: 'Wrong User ID' })
      }
      let user = await User.findOne({ $or: [{ facebookId: req.body.userID }, { email: req.body.email }] })

      if (!user) {
        user = new User({
          email: req.body.email,
          password: nanoid(),
          facebookId: req.body.userID,
          username: req.body.name,
          avatar: req.body.picture.data.url,
          authentication: true,
        })
      }
      const { token, maxAge } = getLiveCookie(user)
      res.cookie('jwt', token, {
        httpOnly: false,
        maxAge: maxAge * 1000,
      })

      user.token = token

      await user.save({ validateBeforeSave: false })
      return res.send(user)
    }

    if (req.query.path === 'vkLogin') {
      const api = new VKAPI({
        accessToken: req.body.session.sid,
      })
      console.log('vk')
      const { user } = req.body.session
      const ticket = await api.users.get({ user_ids: [user.id], fields: ['photo_max_orig'] })

      if (ticket.length === 0 || ticket[0].id !== parseInt(user.id, 10)) {
        return res.status(401).send({ message: 'VK token incorrect!' })
      }

      let userIs = await User.findOne({ $or: [{ vkId: user.id }, { email: req.body.email }] })

      if (!userIs) {
        userIs = new User({
          email: `${user.id}@gmail.com`,
          password: nanoid(),
          vkId: user.id,
          username: `${user.first_name} ${user.last_name}`,
          avatar: ticket[0].photo_max_orig,
          authentication: true,
        })
      }

      const { token, maxAge } = getLiveCookie(user)

      res.cookie('jwt', token, {
        httpOnly: false,
        maxAge: maxAge * 1000,
      })

      userIs.token = token
      await userIs.save({ validateBeforeSave: false })
      return res.send(userIs)
    }

    if (req.query.path === 'googleLogin') {
      const { credential, clientId } = req.body

      const ticket = await client.verifyIdToken({
        idToken: `${credential}`,
        audience: clientId,
      })

      const { name, email, picture, sub } = ticket.payload

      let user = await User.findOne({ email })

      if (!user) {
        user = new User({
          email,
          password: nanoid(),
          username: name,
          avatar: picture,
          googleId: sub,
          authentication: true,
        })
      }

      const { token, maxAge } = getLiveCookie(user)

      res.cookie('jwt', token, {
        httpOnly: false,
        maxAge: maxAge * 1000,
      })

      user.token = token
      await user.save({ validateBeforeSave: false })
      return res.send(user)
    }
  } catch (e) {
    return res.status(500).send({ error: e })
  }
})

// Добавление курса
router.put('/add_course', auth, async (req, res) => {
  const courseId = req.query.course
  const userId = req.user._id

  try {
    const course = await Course.findById(courseId)
    if (!course) {
      return res.status(404).send({ message: 'Course not found!' })
    }

    const courseUser = await User.findOne({ _id: userId }, { myCourses: { $elemMatch: { course: courseId } } })

    if (courseUser.myCourses.length !== 0) {
      return res.status(400).send({ message: 'Пользователь уже подписан на этот курс' })
    }

    await User.findByIdAndUpdate(userId, { $push: { myCourses: { course } } })

    const modulesId = await Module.distinct('_id', { course: courseId })

    const tests = await Test.find({ module: { $in: modulesId } })
    const tasks = await Task.find({ module: { $in: modulesId } })
    const lessons = await Lesson.find({ module: { $in: modulesId } })

    // eslint-disable-next-line no-restricted-syntax
    for (const test of tests) {
      // eslint-disable-next-line no-await-in-loop
      await User.findByIdAndUpdate(userId, { $push: { tests: { test } } })
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const task of tasks) {
      // eslint-disable-next-line no-await-in-loop
      await User.findByIdAndUpdate(userId, { $push: { tasks: { task } } })
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const lesson of lessons) {
      // eslint-disable-next-line no-await-in-loop
      await User.findByIdAndUpdate(userId, { $push: { lessons: { lesson } } })
    }

    return res.send({ message: 'Контент успешно добавлен' })
  } catch (e) {
    return res.status(500)
  }
})

// Изменение статуса
router.patch('/:id/update_status', auth, async (req, res) => {
  const userId = req.params.id
  const contentId = req.query.content

  try {
    const user = await User.findById(req.user._id)

    if (!user) {
      return res.status(404).send({ message: 'User not found!' })
    }
    switch (req.query.params) {
      case 'course': {
        const course = await Course.findById(contentId)
        if (!course) {
          return res.status(404).send({ message: 'Course not found!' })
        }
        await User.updateOne(
          {
            _id: userId,
            'myCourses.course': contentId,
          },
          { $set: { 'myCourses.$.status': true } },
        )
        return res.send({ message: 'Студент прошёл' })
      }
      case 'test': {
        const test = await Test.findById(contentId)
        if (!test) {
          return res.status(404).send({ message: 'Test not found!' })
        }
        await User.updateOne(
          {
            _id: userId,
            'tests.test': contentId,
          },
          { $set: { 'tests.$.status': true } },
        )
        return res.send({ message: 'Студент прошёл' })
      }
      case 'lesson': {
        const lesson = await Lesson.findById(contentId)
        if (!lesson) {
          return res.status(404).send({ message: 'Lesson not found!' })
        }
        await User.updateOne(
          {
            _id: userId,
            'lessons.lesson': contentId,
          },
          { $set: { 'lessons.$.status': true } },
        )
        return res.send({ message: 'Студент прошёл' })
      }
      case 'task': {
        const task = await Task.findById(contentId)
        if (!task) {
          return res.status(404).send({ message: 'Task not found!' })
        }

        const course = await Course.findById(req.query.course)
        if (!course) return res.status(400).send({ error: 'Course not found!' })

        if (!course.teachers.includes(req.user._id)) {
          return res.status(403).send({ message: "User don't have permission" })
        }

        await User.updateOne(
          {
            _id: userId,
            'tasks.task': contentId,
          },
          { $set: { 'tasks.$.status': true } },
        )
        return res.send({ message: 'Студент прошёл' })
      }
      default:
        return res.send({ message: 'Контент не найден!' })
    }
  } catch (e) {
    return res.status(500)
  }
})

router.delete('/sessions', async (req, res) => {
  const success = { message: 'Success' }
  const cookie = req.cookies.jwt

  if (!cookie) return res.send(success)

  const user = await User.findOne({ token: cookie })

  if (!user) return res.send(success)

  const { token } = getLiveCookie(user)
  user.token = token

  await user.save({ validateBeforeSave: false })

  return res.send({ success, user })
})

router.post('/forgot', async (req, res) => {
  try {
    const buf = crypto.randomBytes(20)

    const hash = buf.toString('hex')
    if (!validator.validate(req.body.email)) {
      express.email = {
        message: 'Email not found',
      }
    }

    const user = await User.findOne({ email: req.body.email })
    if (!user) return res.status(404).send({ error: 'User not found' })

    user.resetPasswordToken = hash
    user.resetPasswordExpires = Date.now() + 360000
    await user.save({ validateBeforeSave: false })

    nodemailer.sendForgotPassword(user.email, user.resetPasswordToken)

    return res.send({ message: `На почту ${user.email} было отправлено письмо с восстановлением пароля` })
  } catch (e) {
    return res.status(500)
  }
})

router.post('/reset', async (req, res) => {
  try {
    console.log(req.body)
    const user = await User.findOne({ resetPasswordToken: req.body.hash.hash })

    user.resetPasswordToken = ''
    user.resetPasswordExpires = Date.now() + 360000

    console.log(req.body.hash.newPassword)
    user.password = req.body.hash.newPassword

    await user.save({ validateBeforeSave: false })

    nodemailer.resetPassword(user.email, user.name)

    return res.send({ message: 'Ваш пароль успешно изменен' })
  } catch (e) {
    return res.status(500)
  }
})

router.put('/edit', auth, upload.single('avatar'), async (req, res) => {
  try {
    const userData = req.body

    if (!userData.username || !userData.email) {
      return res.status(400).send({ error: 'username и email обязателен!' })
    }

    if (req.file) {
      userData.avatar = `uploads/${req.file.filename}`
    }

    const user = await User.findByIdAndUpdate(req.user._id, userData, { new: true })

    return res.send(user)
  } catch (e) {
    return res.status(500).send({ error: e })
  }
})

router.put('/edit_password', auth, async (req, res) => {
  try {
    const { password, newPassword } = req.body
    const { user } = req

    if (!password || !newPassword) {
      return res.status(400).send({ error: 'Введите правильный пароль' })
    }

    const isMatch = await user.checkPassword(password)
    if (!isMatch) {
      return res.status(401).send({ error: 'Введен неверный пароль!' })
    }

    user.password = newPassword
    await user.save({ validateBeforeSave: false })

    return res.send(user)
  } catch (e) {
    return res.status(500).send({ error: e })
  }
})

router.patch('/:id/ban', auth, permit('admin'), async (req, res) => {
  try {
    const userId = req.params.id
    const { role } = req.query

    if (role === 'admin') {
      return res.status(400).send({ error: 'Вы не можете выдать админку!' })
    }

    const user = await User.findById(userId)

    if (!user) {
      return res.status(404).send({ error: 'Пользователь не найден!' })
    }

    if (user._id.equals(req.user._id)) {
      return res.status(400).send({ error: 'Вы не можете поменять себе роль!' })
    }

    await User.findByIdAndUpdate(userId, { role })

    return res.send({ message: 'Роль пользователя успешно изменён!' })
  } catch (e) {
    return res.sendStatus(500)
  }
})

router.delete('/:id', auth, permit('admin'), async (req, res) => {
  try {
    const userId = req.params.id

    const user = await User.findById(userId)

    if (!user) {
      return res.status(404).send({ error: 'Пользователь не найден!' })
    }

    if (user._id.equals(req.user._id)) {
      return res.status(400).send({ error: 'Вы не можете удалить себя' })
    }

    await User.deleteOne({ _id: userId })

    return res.send({ message: 'Пользователь удалён' })
  } catch {
    return res.sendStatus(500)
  }
})

module.exports = router
