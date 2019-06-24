#!/usr/bin/env node

/* eslint-disable no-console */
// @ts-check

// builds Windows binary on AppVeyor CI
// but only on the right branch

const shell = require('shelljs')
const os = require('os')
const la = require('lazy-ass')
const is = require('check-more-types')
const path = require('path')
const terminalBanner = require('terminal-banner').terminalBanner

shell.set('-v') // verbose
shell.set('-e') // any error is fatal

// see what variables AppVeyor provides
// https://www.appveyor.com/docs/environment-variables/

const isRightBranch = () => {
  const branch = process.env.APPVEYOR_PULL_REQUEST_HEAD_REPO_BRANCH || process.env.APPVEYOR_REPO_BRANCH
  const shouldForceBinaryBuild = (process.env.APPVEYOR_REPO_COMMIT_MESSAGE || '').includes('[build binary]')

  return branch === 'develop' || shouldForceBinaryBuild
}

const isForkedPullRequest = () => {
  const repoName = process.env.APPVEYOR_PULL_REQUEST_HEAD_REPO_NAME

  return repoName && repoName !== 'cypress-io/cypress'
}

const shouldBuildBinary = () => {
  return isRightBranch() && !isForkedPullRequest()
}

if (!shouldBuildBinary()) {
  console.log('should not build binary')
  process.exit(0)
}

console.log('building Windows binary')

// package archive filename, something like "cypress-3.3.1.tgz"
const filename = `cypress-${process.env.NEXT_DEV_VERSION}.tgz`
const version = process.env.NEXT_DEV_VERSION

la(is.unemptyString(version), 'missing NEXT_DEV_VERSION')

console.log('building version', version)

shell.exec(`node scripts/binary.js upload-npm-package --file cli/build/${filename} --version ${version}`)

const packageFilename = path.join(process.cwd(), 'cli', 'build', filename)

console.log('full package filename:', packageFilename)

const arch = os.arch()

shell.echo(`Building for win32 [${arch}]...`)

shell.cat('npm-package-url.json')
shell.exec(`npm run binary-build -- --platform windows --version ${version}`)

// make sure we are not including dev dependencies accidentally
// TODO how to get the server package folder?
const serverPackageFolder = 'C:/projects/cypress/dist/win32/packages/server'

shell.echo(`Checking prod and dev dependencies in ${serverPackageFolder}`)
shell.exec('npm ls --prod --depth 0 || true', { cwd: serverPackageFolder })
const result = shell.exec('npm ls --dev --depth 0 || true', { cwd: serverPackageFolder })

if (result.stdout.includes('nodemon')) {
  console.error('Hmm, server package includes dev dependency "coveralls"')
  console.error('which means somehow we are including dev dependencies in the output bundle')
  console.error('see https://github.com/cypress-io/cypress/issues/2896')
  process.exit(1)
}

/**
 * Returns true if we are building a pull request
 */
const isPullRequest = () => {
  return Boolean(process.env.APPVEYOR_PULL_REQUEST_NUMBER)
}

if (isPullRequest()) {
  console.log('This is a pull request, skipping uploading binary')
} else {
  console.log('Zipping and upload binary')

  shell.exec('npm run binary-zip')
  shell.ls('-l', '*.zip')

  terminalBanner('installing cypress.zip locally')
  shell.mkdir('test-local-install')
  shell.cd('test-local-install')
  shell.exec(`npm install ${packageFilename}`, {
    env: {
      DEBUG: 'cypress:cli',
      CYPRESS_INSTALL_BINARY: '../cypress.zip',
    },
  })
  shell.cd('..')

  terminalBanner('upload zipped binary')
  shell.exec(`node scripts/binary.js upload-unique-binary --file cypress.zip --version ${version}`)
  shell.cat('binary-url.json')
  shell.exec('node scripts/test-other-projects.js --npm npm-package-url.json --binary binary-url.json --provider appVeyor')
}
