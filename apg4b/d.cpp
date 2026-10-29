#include <bits/stdc++.h>
#define ll long long
using namespace std;
ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

bool range_check(ll i, ll j, ll h, ll w) { return 0 <= j && j < w && 0 <= i && i < h; }

ll mod = 998244353;


int solve() {
	ll t; cin >> t;
	long double PI = 3.1415926535897932384626433832795;
	while (t--) {
		ll n; cin >> n;
		vector<long double> r(n);
		vector<pair<ll, ll >> a(n);
		for (ll i = 0; i < n; i++) {
			ll x, y; cin >> x >> y;
			long double rad = atan2(y, x);
			if (rad < 0) rad = PI * 2 + rad;
			r[i] = rad;
		}
		sort(r.begin(), r.end());
		ll ans = 0;
		for (ll i = 0; i < n; i++) {
			long double rad = r[i];
			long double target = PI + rad;
			if (target > 2 * PI) target = target - 2 * PI;
			auto it = upper_bound(r.begin(), r.end(), target);
			ll idx = it - r.begin();
			if (i <= idx) {
				ans = max(ans,idx - i);
				ans = max(ans,n - (idx - i) + 1);
			} else {
				idx += n;
				ans = max(ans,idx - i);
				ans = max(ans,n - (idx - i) + 1);
			}
		}
		cout << ans << endl;
	}
	return 0;
}

int main() {
	solve();
	return 0;
}
