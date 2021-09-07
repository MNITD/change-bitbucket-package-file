const fs = require('fs').promises
const {exec} = require('child_process')
const {Bitbucket} = require('bitbucket')
const FormData = require('form-data');
require('dotenv').config()

const {BITBUCKET_LOGIN, BITBUCKET_PASSWORD} = process.env

const workspace = BITBUCKET_LOGIN // TODO get from args with default to login
const project = 'project1'
const repo = 'repo1'
const packageName = 'redoc'
const version = '2.0.0-rc.30'

const MAIN_BRANCH = 'master' // TODO move to script args

const getBranchName = (packageName) => `deps/update-${packageName}-version-${Date.now()}`

const getLastCommit = async (bitbucket, workspace, repo) => {
  const {data} = await bitbucket.repositories.listCommits({repo_slug: repo, workspace})
  console.log(data.values)
  return data.values[0].hash // TODO filter by master branch
}

const getPackageJSON = async (bitbucket, workspace, project, repo, commit) => {
  const [packageJSON, packageLockJSON] = (await Promise.all([
    bitbucket.repositories.readSrc({commit, path: 'package.json', repo_slug: repo, workspace}),
    bitbucket.repositories.readSrc({commit, path: 'package-lock.json', repo_slug: repo, workspace}),
  ])).map(res => res.data)

  return {packageJSON, packageLockJSON}
}

const savePackageFiles = async (files) => {
  await Promise.all([
    fs.writeFile('target/package.json', files.packageJSON),
    fs.writeFile('target/package-lock.json', files.packageLockJSON),
  ])
}

const readPackageFiles = async () => {
  const files = await Promise.all([
    fs.readFile('target/package.json', 'utf8'),
    fs.readFile('target/package-lock.json', 'utf8'),
  ])
  return [{ name: 'package.json', value: files[0] }, { name: 'package-lock.json', value: files[1] }]
}

const updatePackageJSON = async (packageName, version) =>
  new Promise((res, rej) => {
    exec(`cd target && npm install ${packageName}@${version}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`)
        return rej(error)
      }
      console.log(`stdout: ${stdout}`)
      console.error(`stderr: ${stderr}`)
      return res()
    })
  })

const createCommit = async (bitbucket, workspace, repo, branch, packageName, version, files) => {
  const form = new FormData();
  files.forEach(f => form.append(f.name, f.value))

  await bitbucket.repositories.createSrcFileCommit({
    _body: form,
    author: 'redocly-depbot <depbot@redoc.ly>',
    branch,
    message: `[chore] update ${packageName} to version ${version}`,
    repo_slug: repo,
    workspace,
  }).then(console.log).catch(console.error)

}

const createBranch = async (bitbucket, workspace, repo, branch, commit) => {
  const {data} = await bitbucket.repositories.createBranch({
    _body: {
      'name': branch,
      'target': {
        'hash': commit,
      },
    },
    repo_slug: repo,
    workspace,
  })
  return data
}


const createPullRequest = (bitbucket, workspace, repo, branch, packageName, version) => {
  return bitbucket.repositories.createPullRequest({
    _body: {
      "title": `[Redocly] Update ${packageName} to version ${version}`,
      "source": {
        "branch": {
          "name": branch
        }
      },
      "destination": {
        "branch": {
          "name": MAIN_BRANCH
        }
      }
    },
    repo_slug: repo,
    workspace
  })
}

(async () => {
  const bitbucket = new Bitbucket(
    {
      auth: {
        username: BITBUCKET_LOGIN,
        password: BITBUCKET_PASSWORD,
      },
    },
  )

  const lastCommit = await getLastCommit(bitbucket, workspace, repo)
  const branch = getBranchName(packageName)

  const originalFiles = await getPackageJSON(bitbucket, workspace, project, repo, lastCommit)
  await savePackageFiles(originalFiles)
  await updatePackageJSON(packageName, version)

  const files = await readPackageFiles()

  await createBranch(bitbucket, workspace, repo, branch, lastCommit)
  await createCommit(bitbucket, workspace, repo, branch, packageName, version, files)
  await createPullRequest(bitbucket,  workspace, repo, branch, packageName, version)
})()


// TODO add Dockerfile
// TODO change package version without installing modules
// TODO authorize without login/password
// TODO CLI approach and not hardcoded arguments
