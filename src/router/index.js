import Vue from 'vue'
import Router from 'vue-router'
import { store } from '../store'

const routerOptions = [
  { path: '/', component: 'Home', meta: {'title': 'Home'} },
  { path: '/index.html', component: 'Home', meta: {'title': 'Home'} },
  { path: '/gem', component: 'Gem', meta: {'title': 'Gem', requiresAuth: true} },
  { path: '/gems', component: 'Gems', meta: {'title': 'Gems'} },
  { path: '/landing', component: 'Landing', meta: {'title': 'Landing'} },
  { path: '/signin', component: 'Signin', meta: {'title': 'Sign In'} },
  { path: '/signup', component: 'Signup', meta: {'title': 'Sign Up'} },
  { path: '/stats', component: 'Stats', meta: {'title': 'Stats'} },
  { path: '/stone', component: 'Stone', meta: {'title': 'Stone'} },
  { path: '*', component: 'NotFound', meta: {'title': 'Page Not Found'} }
]

const routes = routerOptions.map(route => {
  return {
    ...route,
    component: () => import(`@/components/${route.component}.vue`)
  }
})

Vue.use(Router)

const router = new Router({
  mode: 'history',
  routes
})

router.beforeEach((to, from, next) => {
  const requiresAuth = to.matched.some(record => record.meta.requiresAuth)
  const isAuthenticated = store.getters.isAuthenticated
  if (requiresAuth && !isAuthenticated) {
    document.title = 'Signin - Jasper'
    next('/signin')
  } else {
    document.title = to.meta.title + ' - Jasper'
    next()
  }
})

export default router
