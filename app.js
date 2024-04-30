const express = require('express')
const path = require('path')

const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const app = express()
app.use(express.json())

const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const {v4: uuidv4} = require('uuid')
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
    FROM follower INNER JOIN user on user.user_id = follower.following_user_id
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
   SELECT name FROM user INNER JOIN follower on follower.follower_user_id= user.user_id
    WHERE follower.following_user_id=${user_id};`
  const result = await db.all(getFollowerQuery)
  response.send(result)
})

app.get('/tweets/:tweetId/', authenticateToken, async (request, response) => {
  const {tweetId} = request.params
  const {username} = request
  const userIdQueary = `SELECT user_id FROM user WHERE username='${username}';`
  const userIdresult = await db.get(userIdQueary)
  const {user_id} = userIdresult
  const tweetsQuery = `
  SELECT
  *
  FROM tweet
  WHERE tweet_id=${tweetId}
  `
  const tweetResult = await db.get(tweetsQuery)
  const userFollowersQuery = `
  SELECT
  *
  FROM follower INNER JOIN user on user.user_id = follower.following_user_id
  WHERE follower.follower_user_id = ${user_id};`
  const userFollowers = await db.all(userFollowersQuery)
  if (
    userFollowers.some(item => item.following_user_id === tweetResult.user_id)
  ) {
    const finalResultQuery = `
      select tweet.tweet,(
      SELECT COUNT(like_id)
      FROM like
      WHERE tweet_id=tweet.tweet_id
      ) AS likes,
      (
      SELECT COUNT(reply_id)
      FROM reply
      WHERE tweet_id=tweet.tweet_id
      ) AS replies,  tweet.date_time as dateTime
      from tweet inner join reply on tweet.tweet_id = reply.tweet_id inner join like on tweet.tweet_id = like.tweet_id
      where tweet.tweet_id = ${tweetId}`
    const resultData = await db.get(finalResultQuery)
    response.send(resultData)
  } else {
    response.status(401).send('Invalid Request')
  }
})

app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = request

    // 1) Getting logged in user object
    const userObject = await db.get(
      `SELECT user_id FROM user WHERE username='${username}'`,
    )

    // 2) Getting tweetObject with tweet_id
    const tweetsQuery = `
   SELECT 
   *
   FROM tweet
 
   WHERE tweet_id=${tweetId}
   `

    const tweetResult = await db.get(tweetsQuery)

    const userFollowersQuery = `
    SELECT 
    *
   FROM follower INNER JOIN user on user.user_id = follower.following_user_id
    WHERE follower.follower_user_id = ${userObject.user_id};`

    const userFollowers = await db.all(userFollowersQuery)

    if (
      userFollowers.some(item => item.following_user_id === tweetResult.user_id)
    ) {
      const likesQuery = `
                SELECT 
                name
                FROM reply NATURAL JOIN user
                WHERE tweet_id=${tweetId} 
                `
      const result = await db.all(likesQuery)
      response.send({likes: result})
    } else {
      response.status(401).send('Invalid Request')
    }
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params //Getting the TweetIdconst

    getFollowingQuery = `SELECT
        DISTINCT(tweet_id)
    FROM
        follower INNER JOIN tweet 
    ON follower.following_user_id=tweet.user_id
    WHERE tweet.tweet_id=${tweetId};` //Getting tweetId of the followers

    const results = await db.get(getFollowingQuery)
    if (results === undefined) {
      //If therre is no results found then the request is invalid
      response.status(401)
      response.send('Invalid Request')
    } else {
      const tweetInfoQuery = `
       SELECT
        name,reply
       FROM reply NATURAL JOIN user
       WHERE tweet_id= ${tweetId};` //Getting the name and replies of the tweet.
      const dbResponse = await db.all(tweetInfoQuery)
      response.send({replies: dbResponse}) //Sending response as given in the description.
    }
  },
)

app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {username} = request
  const userIdQueary = `select user_id from user where username='${username}'`
  const userIdresult = await db.get(userIdQueary)
  const {user_id} = userIdresult
  const tweetsQuery = `
SELECT
tweet,
(
SELECT COUNT(like_id)
FROM like
WHERE tweet_id=tweet.tweet_id
) AS likes,
(
SELECT COUNT(reply_id)
FROM reply
WHERE tweet_id=tweet.tweet_id
) AS replies,
date_time AS dateTime
FROM tweet
WHERE user_id= ${user_id}
`
  const result = await db.all(tweetsQuery)
  response.send(result)
})

app.post("/user/tweets", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  console.log(tweet);
  const { username } = request;
  try {
    // Get the user_id using a parameterized query
    const userIdQuery = `SELECT user_id FROM user WHERE username = '${username}'`;//Write ? here
    const userIdResult = await db.get(userIdQuery, [username]);
    const { user_id } = userIdResult;
    const postTweetQuery = `
      INSERT INTO tweet (tweet, user_id)
    VALUES ('${tweet}',${user_id});
    `;
    await db.run(postTweetQuery, [tweet, user_id]);//Insert tweet and user_id only
    response.send("Created a Tweet");
  } catch (error) {
    response.status(401).send("Invalid Request");
  }
});

app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = request
    const userIdQueary = `select user_id from user where username='${username}'`
    const userIdresult = await db.get(userIdQueary)
    const {user_id} = userIdresult
    console.log(user_id)
    const tweetsQuery = `select * from tweet where tweet_id = ${tweetId}`
    const tweetResult = await db.get(tweetsQuery)
    console.log(tweetResult.user_id)
    const isTrue = tweetResult.user_id == user_id
    if (isTrue) {
      const deleteQuery = `
    delete from tweet where tweet_id = ${tweetId}`
      await db.run(deleteQuery)
      response.send('Tweet Removed')
    } else {
      response.status(401).send('Invalid Request')
    }
  },
)
module.exports = app
