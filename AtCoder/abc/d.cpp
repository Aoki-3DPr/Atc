#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll t;
	cin >> t;
	while (t--) {
		ll n;
		cin >> n;
		vector<ll> a(n);
		for (ll i = 0; i < n; i++) cin >> a[i];
		sort(a.begin(), a.end());
		ll ans1 = 0;
		ll ans2 = 0;
		for (ll i = 0; i < n; i++) {
			while (i < n - 1 && a[i] == a[i + 1]) i++;
			if (i == n - 1) break;
			ll buf = abs(a[i] - a[i + 1]);
			ans1 += min(i + 1, n - i - 1) * buf;
			ans2 += buf;
		}
		cout << ans1 << " " << ans2 << endl;
	}
	return 0;
}

int main() {
	solve();
	return 0;
}
