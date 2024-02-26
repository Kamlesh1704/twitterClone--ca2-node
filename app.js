const express = require('express')
const path = require('path')

const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const app = express()
app.use(express.json())

const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const dbPath = path.join(__dirname, 'twitterClone.db')

let db = null

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}

initializeDBAndServer()

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    if (request.body.password.length < 6) {
      response.status(400).send('Password is too short')
    } else {
      const hashedPassword = await bcrypt.hash(request.body.password, 10)
      const createUserQuery = `
            INSERT INTO 
                user ( username,password, name, gender) 
            VALUES 
                (
                '${username}', 
                '${hashedPassword}', 
                '${name}',
                '${gender}'
                )`
      const dbResponse = await db.run(createUserQuery)
      response.status(200).send('User created successfully')
    }
  } else {
    response.status(400).send('User already exists')
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      }
      const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

const authenticateToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        next()
      }
    })
  }
}

app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const {username} = request
  const userIdQueary = `
  SELECT user_id FROM user WHERE username='${username}';`
  const userIdresult = await db.get(userIdQueary)
  const {user_id} = userIdresult
  const tweetsQuery = `
    SELECT
    user.username, tweet.tweet, tweet.date_time AS dateTime
    FROM
    follower
    INNER JOIN tweet
    ON follower.following_user_id = tweet.user_id
    INNER JOIN user
    ON tweet.user_id = user.user_id
    WHERE
    follower.follower_user_id = ${user_id}
    ORDER BY
    tweet.date_time DESC
    LIMIT 4;`
  const result = await db.all(tweetsQuery)
  response.send(result)
})

app.get('/user/following/', authenticateToken, async (request, response) => {
  const {username} = request
  const userIdQueary = `
  SELECT user_id FROM user WHERE username='${username}';`
  const userIdresult = await db.get(userIdQueary)
  const {user_id} = userIdresult
  const tweetsQuery = `
    SELECT
    name
    FROM follower INNER JOIN user on user.user_id = follower.follower_user_id
    WHERE follower.follower_user_id = ${user_id};`
  const result = await db.all(tweetsQuery)
  response.send(result)
})

app.get('/user/followers/', authenticateToken, async (request, response) => {
  const {username} = request
  const userIdQueary = `
  SELECT user_id FROM user WHERE username='${username}';`
  const userIdresult = await db.get(userIdQueary)
  const {user_id} = userIdresult
  const getFollowerQuery = `
   SELECT name FROM user INNER JOIN follower on follower.following_user_id= user.user_id
    WHERE follower.following_user_id=${user_id};`
  const result = await db.all(getFollowerQuery)
  response.send(result)
})

const checkingFollowing = async (request, response, next) => {
  const {tweetId} = request.params
  const {username} = request
  const userIdQueary = `
  SELECT user_id FROM user WHERE username='${username}';`
  const userIdresult = await db.get(userIdQueary)
  const {user_id} = userIdresult
  const tweetsQuery = `
    SELECT
    tweet.tweet_id
    FROM tweet INNER JOIN user on user.user_id = tweet.user_id
    INNER JOIN follower on follower.follower_user_id = user.user_id
    WHERE follower.follower_user_id = ${user_id};`
  const result = await db.all(tweetsQuery)
  console.log(result)
  console.log(result.some(eachId => (eachId.tweet_id = tweetId)))
  if (result.some(eachId => eachId.tweet_id === tweetId)) {
    next()
  } else {
    response.status(401).send('Invalid Request')
  }
}

app.get(
  '/tweets/:tweetId/',
  authenticateToken,
  checkingFollowing,
  async (request, response) => {
    const {tweetId} = request.params
    const resultQuery = `
   SELECT tweet.tweet , COUNT(like.like_id) AS likes , COUNT(reply.reply_id) AS replies , tweet.date_time AS dateTime
   FROM tweet  JOIN reply JOIN like
   WHERE tweet.tweet_id = ${tweetId};`
    const result = await db.all(resultQuery)
    response.send(result)
  },
)
module.exports = app
