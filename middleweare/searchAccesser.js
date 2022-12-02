const Course = require('../models/Course')

const searchAccesser = async (req, res, next) => {
  const course = await Course.findById(req.query.course)

  if (!course) return res.status(400).send({ error: 'Course not found!' })

  if (!course.teachers.includes(req.user._id)) {
    return res.status(403).send({ message: "User don't have permission" })
  }

  next()
}

module.exports = searchAccesser
