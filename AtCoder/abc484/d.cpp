#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n; cin >> n;
	vector<ll> v(n);
	vector<ll> num(n + 1);
	for (ll i = 0; i < n; i++) {
		cin >> v[i];
	}
	ll ans = 1;
	for (ll i = 0; i < n; i++) {
		ans += i - num[v[i]];
		num[v[i]]++;
		while(i + 1 < n && v[i] == v[i + 1]) {
			i++;
			num[v[i]]++;
		}
	}
	cout << ans << endl;
	return 0;
}

int main() {
	solve();
    return 0;
}

