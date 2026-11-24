#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	string s; cin >> s;
	vector<ll> v(26);
	for (ll i = 0; i < s.length(); i++) {
		v[s[i] - 'a']++;
	}
	for (ll i = 0; i < 26; i++) {
		if (v[i] == 0) {
			cout << char('a' + i);
			return 0;
		}
	}
	cout << "None";
	return 0;
}

int main() {
	solve();
	return 0;
}
